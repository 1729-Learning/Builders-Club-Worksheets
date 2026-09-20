/*
  #/instructor — the class, two ways.

  The GRID is one row per builder, one column per core step. It answers "where is
  everyone" in a single look, and it is the only screen that shows a step nobody
  has reached yet as different from one nobody has started — which is the
  difference between a class that is stuck and a class that simply hasn't got
  there.

  The BOARD answers a different question — "who needs me today" — by sorting every
  builder into exactly one of three states:

      Dormant     hasn't opened the worksheets in a week
      Behind      below the class median, or stuck on a step
      On track    at or past the median, nothing stuck

  The states are deliberately exhaustive and mutually exclusive, in that order of
  urgency: everyone is in exactly one column, so the columns add up to the class.
  Someone both dormant and behind appears under Dormant, because they have
  stopped showing up and that is the more useful fact.

  Colour is load-bearing here, so it is kept honest in one place, `cellState`
  below. Coral only ever means "a human should look at this".
*/
'use strict';

/* eslint-disable no-var */
var viewClass = (function () {
  const DORMANT_DAYS = 7;

  const GROUPS = [
    { key: 'dormant', title: 'Dormant', note: `Not seen in ${DORMANT_DAYS} days.` },
    { key: 'behind', title: 'Behind', note: 'Below the class median, or stuck on a step.' },
    { key: 'ontrack', title: 'On track', note: 'At or past the median, nothing stuck.' },
  ];

  const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  /* ---------------------------------------------------------------- reachability

     Which steps could this builder have got to? The worksheets gate progress
     section by section and step by step, so a blank cell means one of two very
     different things, and the grid has to tell them apart. This mirrors
     sectionUnlocked / activeStepIndex / stepViewable in public/app.js — the
     student's own view of what is open to them. */
  function reachableKeys(rec, curriculum) {
    const open = new Set();
    const isDone = k => !!(rec.steps[k] && rec.steps[k].status === 'done');
    const isMastered = k => !!(rec.steps[k] && rec.steps[k].status === 'mastered');
    const credited = k => isDone(k) || isMastered(k);

    const sectionDone = sec => {
      const artifact = sec.steps.find(s => s.isArtifact);
      if (artifact) return isDone(artifact.key);
      return sec.steps.length > 0 && sec.steps.every(s => credited(s.key));
    };

    for (const w of curriculum.worksheets) {
      w.sections.forEach((sec, i) => {
        const roams = rec.freeRoam || w.freeRoam;
        const unlocked = roams || sec.alwaysUnlocked || i === 0 || sectionDone(w.sections[i - 1]);
        if (!unlocked) return;
        // Within an unlocked section, everything up to and including the first
        // unfinished step is open; free roam opens the lot.
        let active = sec.steps.findIndex(s => !credited(s.key));
        if (active === -1) active = sec.steps.length - 1;
        sec.steps.forEach((s, j) => {
          if (roams || j <= active || credited(s.key)) open.add(s.key);
        });
      });
    }
    return open;
  }

  /* One cell, one meaning. `fought` is a modifier rather than a seventh colour:
     a step that was passed after a real struggle is still passed, and flattening
     that into "stuck" would misreport someone who got there. */
  function cellState(key, rec, reachable, stuckAt) {
    const st = rec.steps[key];
    if (!st) return { state: reachable.has(key) ? 'notStarted' : 'notReached', fought: false };
    if (st.status === 'mastered') return { state: 'mastered', fought: false };
    if (st.status === 'done') return { state: 'done', fought: st.attempts >= stuckAt };
    return { state: st.attempts >= stuckAt ? 'stuck' : 'inProgress', fought: false };
  }

  const CELL_WORDS = {
    done: 'finished', mastered: 'skipped by Builders AI — no XP', inProgress: 'in progress',
    stuck: 'stuck', notStarted: 'not started', notReached: 'not unlocked yet',
  };

  /* ---------------------------------------------------------------- rows */

  function buildRows(app) {
    const S = store.STATE;
    const records = S.records;
    const roll = aggregate.buildCohortRollup(records, CURRICULUM, S.roster.students);
    const flags = aggregate.buildFlags(records, CURRICULUM, S.roster.students);
    const med = roll.medianFrontier;
    const stuckIds = new Set(flags.filter(f => f.code === 'stuck').map(f => f.studentId));
    const cutoff = Date.now() - DORMANT_DAYS * 86400000;

    const rows = records.map(rec => {
      const p = aggregate.computeStudentProgress(rec, CURRICULUM);
      const stuck = stuckIds.has(p.studentId);
      const dormant = !!rec.lastSeen && rec.lastSeen < cutoff;
      return {
        id: p.studentId, name: p.name, rec, progress: p, stuck, dormant,
        behindBy: med == null ? null : med - p.frontier,
        state: dormant ? 'dormant' : (stuck || (med != null && p.frontier < med)) ? 'behind' : 'ontrack',
      };
    });
    rows.sort((a, b) => (b.behindBy == null ? -1e9 : b.behindBy) - (a.behindBy == null ? -1e9 : a.behindBy)
      || a.name.localeCompare(b.name));
    return { rows, roll, med };
  }

  /* ---------------------------------------------------------------- the grid */

  function gridHTML(rows) {
    const sections = CURRICULUM.core.flatMap(w => w.sections);
    const stuckAt = aggregate.THRESHOLDS.STUCK_ATTEMPTS;

    const bands = sections.map(sec => `
      <th class="m-band" colspan="${sec.steps.length}" title="${ui.escapeAttr(sec.title)}">
        <a href="#/instructor/steps/${encodeURIComponent(sec.id)}">${sec.num}</a>
      </th>`).join('');

    const body = rows.map(row => {
      const reachable = reachableKeys(row.rec, CURRICULUM);
      const cells = sections.map(sec => sec.steps.map(step => {
        const { state, fought } = cellState(step.key, row.rec, reachable, stuckAt);
        const st = row.rec.steps[step.key];
        const tip = `${row.name} · ${step.title} — ${CELL_WORDS[state]}`
          + (st && st.attempts ? ` (${st.attempts} attempt${st.attempts === 1 ? '' : 's'})` : '');
        // A step they could not have reached is not a link to anywhere useful.
        return state === 'notReached'
          ? `<td class="m-cellcol"><span class="m-cell notReached" title="${ui.escapeAttr(tip)}"></span></td>`
          : `<td class="m-cellcol"><a class="m-cell ${state}${fought ? ' fought' : ''}"
               href="#/instructor/step/${encodeURIComponent(step.key)}"
               title="${ui.escapeAttr(tip)}" aria-label="${ui.escapeAttr(tip)}"></a></td>`;
      }).join('')).join('');
      const pos = row.behindBy == null || row.behindBy === 0 ? '·' : row.behindBy > 0 ? `−${row.behindBy}` : `+${-row.behindBy}`;
      return `<tr class="is-${row.state}">
        <td class="m-name"><a href="#/instructor/b/${encodeURIComponent(row.id)}">${ui.esc(row.name)}</a></td>
        ${cells}
        <td class="m-pos" title="steps from the class median">${pos}</td>
      </tr>`;
    }).join('');

    return `
      <div class="m-legend">
        ${Object.entries(CELL_WORDS).map(([k, v]) => `<span class="m-key"><i class="m-cell ${k}"></i>${ui.esc(v)}</span>`).join('')}
        <span class="m-key"><i class="m-cell done fought"></i>passed after 3+ tries</span>
      </div>
      <div class="m-wrap">
        <table class="m-table">
          <thead>
            <tr><th class="m-name"></th>${bands}<th class="m-pos"></th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="sec-tagline">The number on the right is how many steps from the class median someone is. It is a
      position, not a grade, and it makes no claim about how hard anyone worked.</p>`;
  }

  /* ---------------------------------------------------------------- the board */

  const lastLine = row => {
    const lf = row.progress.lastFinished;
    return lf ? `${lf.sectionNum}. ${lf.title}` : 'Nothing finished yet';
  };

  const standing = row => row.stuck ? ui.pill('stuck', 'coral')
    : row.behindBy == null ? ''
      : row.behindBy > 0 ? `${row.behindBy} behind`
        : row.behindBy === 0 ? 'on median' : `${-row.behindBy} ahead`;

  function boardHTML(grouped) {
    return `<div class="board">
      ${grouped.map(g => `
        <div class="board-col">
          <div class="board-colhead is-${g.key}">
            <h2>${ui.esc(g.title)}</h2><span class="n">${g.rows.length}</span>
          </div>
          ${g.rows.length ? g.rows.map(boxHTML).join('')
    : `<p class="board-empty">${ui.esc(g.key === 'dormant' ? 'Everyone has been in this week.' : g.key === 'behind' ? 'Nobody is behind.' : 'Nobody here yet.')}</p>`}
        </div>`).join('')}
    </div>`;
  }

  function boxHTML(row) {
    const p = row.progress;
    return `
      <a class="sbox is-${row.state}" href="#/instructor/b/${encodeURIComponent(row.id)}">
        <div class="sbox-main">
          <div class="sbox-name">${ui.esc(row.name)}</div>
          <div class="sbox-sub">${p.frontier}/${p.stepsTotal} steps · ${p.xpEarned} XP${row.stuck ? ' · stuck' : ''}</div>
        </div>
        <div class="sbox-last">
          <span class="kicker">Last finished</span>
          ${ui.esc(lastLine(row))}
        </div>
      </a>`;
  }

  function listHTML(grouped) {
    return grouped.map(g => `
      <section class="group">
        <div class="group-head">
          <h2>${ui.esc(g.title)}</h2><span class="group-count">${g.rows.length}</span><span class="group-rule"></span>
          <span class="mono">${ui.esc(g.note)}</span>
        </div>
        ${g.rows.length ? `<div class="slist">${g.rows.map(rowHTML).join('')}</div>` : '<p class="board-empty">Nobody here.</p>'}
      </section>`).join('');
  }

  function rowHTML(row) {
    const p = row.progress;
    return `
      <a class="zrow is-${row.state}" href="#/instructor/b/${encodeURIComponent(row.id)}">
        <span class="z">
          <span class="z-name">${ui.esc(row.name)}</span>
          <span class="z-label">${p.frontier}/${p.stepsTotal} steps · ${p.xpEarned} XP</span>
        </span>
        <span class="z">
          <span class="z-label">Last finished</span>
          <span class="z-val">${ui.esc(lastLine(row))}</span>
        </span>
        <span class="z right">
          <span class="z-label">Standing</span>
          <span class="z-val">${standing(row) || '—'}</span>
        </span>
      </a>`;
  }

  /* ---------------------------------------------------------------- render */

  function render(app) {
    const S = store.STATE;
    if (!S.records.length) {
      return ui.emptyState('Nobody has signed in yet',
        'As soon as a student opens the link and signs in, they appear here.', '');
    }

    const { rows, roll } = buildRows(app);
    const view = S.ui.dash || 'grid';
    const grouped = GROUPS.map(g => Object.assign({}, g, { rows: rows.filter(r => r.state === g.key) }));

    return `
      <div class="stack">
        <div class="page-head"><h1>Class</h1></div>

        <div class="statrow">
          ${ui.stat(roll.builders, 'builders', '', '')}
          ${ui.stat(roll.medianFrontier == null ? '—' : roll.medianFrontier, 'median steps', `of ${CURRICULUM.coreStepCount}`, 'blue')}
          ${ui.stat(roll.artifactsEarned, 'artifacts earned', `of ${roll.builders * CURRICULUM.artifactCount}`, 'green')}
          ${ui.stat(roll.inProgressSteps, 'steps in progress', '', 'yellow')}
        </div>

        <div class="chips">
          ${ui.chip('Grid', { on: view === 'grid', attr: 'data-dash="grid"' })}
          ${ui.chip('Board', { on: view === 'board', attr: 'data-dash="board"' })}
          ${ui.chip('List', { on: view === 'list', attr: 'data-dash="list"' })}
        </div>

        ${view === 'grid' ? gridHTML(rows) : view === 'board' ? boardHTML(grouped) : listHTML(grouped)}

        ${ui.card(`
          <div class="card-head"><div class="kicker">Backup</div></div>
          <div class="backup-row">
            <button class="btn" data-classexport>⬇ Download class backup</button>
            <button class="btn white" data-classimport>⬆ Restore class backup</button>
            <input type="file" id="classArchiveFile" accept=".json,application/json" style="display:none">
          </div>
          <p class="sec-tagline" style="margin-bottom:0">One file holding every student's work. Keep a copy
          somewhere that isn't this server.</p>
        `, 'flat')}
      </div>`;
  }

  function wire(app) {
    app.on('[data-dash]', el => {
      store.STATE.ui.dash = el.getAttribute('data-dash');
      store.saveUi();
      app.render();
    });
  }

  return { render, wire, buildRows, initials, reachableKeys, cellState };
}());

// Dual-export, like the other shared files: the grid's colour rules are the
// load-bearing new code here, so they are testable in plain node.
if (typeof module !== 'undefined' && module.exports) module.exports = viewClass;
if (typeof window !== 'undefined') window.viewClass = viewClass;

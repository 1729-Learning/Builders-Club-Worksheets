/*
  #/instructor/b/:oid — one builder, and everything they actually wrote.

  Three questions in order: how far along are they, where are they stuck, and what
  did they write? The two core worksheets get a bar each rather than one nine-part
  bar, because they run in PARALLEL — gating is sequential inside a worksheet only,
  so a single bar would imply an order that doesn't exist.

  Print gives the 1:1 one-pager: the positions, the artifacts, and where they're
  stuck, with the attempt threads folded away.
*/
'use strict';

/* eslint-disable no-var */
var viewBuilder = (function () {
  /* `rec` is a full record, fetched by the router — this is the screen that shows
     the writing, so it is the screen that pays for it. The cohort numbers around
     it still come from the class-wide digest, which is all they need. */
  function render(app, rec) {
    const S = store.STATE;
    const id = rec.rosterId;

    const p = aggregate.computeStudentProgress(rec, CURRICULUM);
    const records = S.records;
    const roll = aggregate.buildCohortRollup(records, CURRICULUM, S.roster.students);
    const net = roll.medianFrontier - p.frontier;
    const flags = aggregate.buildFlags(records, CURRICULUM, S.roster.students).filter(f => f.studentId === p.studentId || f.studentId === id);

    return `
      <p class="no-print"><a class="mono" href="#/instructor">${ui.icon.back} The class</a></p>

      ${ui.card(`
        <div class="card-head">
          <div>
            <div class="kicker">Builder</div>
            <h1 style="margin:0">${ui.esc(p.name)}</h1>
            <div class="mono">${ui.esc(rec.email || '')}${rec.header.exportedAt ? ` · last worked ${ui.dayYear(rec.header.exportedAt)}` : ''}</div>
          </div>
          <div class="chips no-print" style="margin-left:auto">
            <a class="btn white sm" href="#/instructor/read/${encodeURIComponent(id)}">Read their worksheets</a>
            <button class="btn white sm" data-dl="${ui.escapeAttr(id)}">⬇ Builder file</button>
            <button class="btn white sm" data-print>${ui.icon.print} Print one-pager</button>
          </div>
        </div>
        <div class="statrow" style="margin:10px 0 0">
          ${ui.stat(`${p.frontier}/${p.stepsTotal}`, 'core steps', p.stepsMastered ? `${p.stepsDone} done + ${p.stepsMastered} skipped by the AI` : `${p.stepsDone} done`, 'blue')}
          ${ui.stat(`${p.artifactsEarned}/${p.artifactsTotal}`, 'artifacts', 'sections finished', 'green')}
          ${ui.stat(p.xpEarned, 'XP', `of ${p.xpMax}${p.xpMismatch ? ` · the app says ${p.xpClaimed}` : ''}`, p.xpMismatch ? 'yellow' : 'green')}
          ${ui.stat(net === 0 ? '—' : Math.abs(net), net > 0 ? 'steps behind' : net === 0 ? 'on the median' : 'steps ahead', `class median ${roll.medianFrontier}`, net > 0 ? 'yellow' : 'green')}
        </div>
        ${p.stepsInProgress ? `<p class="mono" style="margin-top:8px">${p.stepsInProgress} step${p.stepsInProgress === 1 ? '' : 's'} open right now</p>` : ''}
      `)}

      ${flags.length ? ui.card(`
        <div class="card-head"><div class="kicker">Needs attention</div></div>
        ${flags.map(f => `<div class="flag"><span class="dot ${f.tone}"></span><div class="flag-body">
          <div class="flag-title">${ui.esc(f.title)}</div><div class="flag-detail">${ui.esc(f.detail)}</div></div></div>`).join('')}
      `) : ''}

      ${rec.unresolved.length ? `<div class="banner no-print">${rec.unresolved.length} step${rec.unresolved.length === 1 ? '' : 's'} in their work no longer match the worksheets — probably renamed or removed since. Their answers are at the bottom.</div>` : ''}

      ${ui.card(`
        <div class="card-head"><div class="kicker">Position</div></div>
        ${p.perWorksheet.filter(w => !w.extra).map(w => `
          <div style="margin-bottom:10px">
            <div class="mono">${ui.esc(w.title)} — ${w.done + w.mastered} of ${w.total} steps · ${w.xp} of ${w.maxXp} XP</div>
            ${ui.segbar(p.sections.filter(s => s.worksheetId === w.worksheetId).map(s => s.state))}
          </div>`).join('')}
        ${p.extraStepsDone ? `<div class="mono">Extras shelf: ${p.extraStepsDone} step${p.extraStepsDone === 1 ? '' : 's'} done (these award no XP)</div>` : ''}
      `)}

      ${(() => {
        const live = p.sections.filter(s => !s.extra && (s.done || s.mastered || s.inProgress));
        /* Open where the mentor is most likely heading — the section still in
           progress, or failing that the last one with work in it, so the page
           always shows some actual writing without a click. */
        let open = live.filter(s => s.state !== 'done').map(s => s.sectionId);
        if (!open.length && live.length) open = [live[live.length - 1].sectionId];
        return live.map(sec => sectionHTML(rec, sec, open.includes(sec.sectionId))).join('');
      })()}

      ${rec.unresolved.length ? ui.card(`
        <div class="card-head"><div class="kicker">Not in the current worksheets</div></div>
        ${rec.unresolved.map(u => `
          <div class="steprow">
            <div class="steprow-head"><h3>${ui.esc(u.titleInFile)}</h3>${ui.pill('unmatched', 'yellow')}</div>
            ${u.promptInFile ? `<p class="prompt">${ui.esc(u.promptInFile)}</p>` : ''}
            ${ui.answerBox(u.answerPreview)}
          </div>`).join('')}
      `) : ''}
    `;
  }

  /* A section is a titled band with its artifact and a one-line summary. The work
     itself sits behind a fold — open by default only where the mentor is most
     likely to be heading: the section they are currently stuck in. */
  function sectionHTML(rec, sec, openByDefault) {
    const section = CURRICULUM.sectionById(sec.sectionId);
    const videos = section.steps.filter(s => s.type === 'video');
    const videosDone = videos.filter(s => rec.steps[s.key]).length;
    const written = section.steps.filter(s => s.type !== 'video' && rec.steps[s.key]);
    const stuckHere = written.some(s => {
      const st = rec.steps[s.key];
      return st.status === 'inProgress' && st.attempts >= aggregate.THRESHOLDS.STUCK_ATTEMPTS;
    });

    const state = sec.state === 'done' ? 'green' : sec.inProgress ? 'blue' : '';
    const summary = [
      `${sec.done + sec.mastered} of ${sec.total} steps`,
      videos.length ? `${videosDone}/${videos.length} videos` : '',
      written.length ? `${written.length} written answer${written.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ');

    return `
      <section class="group">
        <div class="group-head">
          <h2>${sec.num}. ${ui.esc(sec.title)}</h2>
          ${sec.state === 'done' ? ui.pill('finished', 'green') : stuckHere ? ui.pill('stuck here', 'coral') : sec.inProgress ? ui.pill('in progress', 'blue') : ''}
          <span class="group-rule"></span>
          <span class="mono">${ui.esc(summary)}</span>
        </div>

        ${sec.artifact ? `<div class="artifact"><div class="kicker">${ui.esc(sec.artifactLabel)}</div>${ui.esc(sec.artifact.text) || '(empty)'}</div>` : ''}

        ${written.length ? `
          <details class="fold card" ${openByDefault || stuckHere ? 'open' : ''}>
            <summary>${written.length} written answer${written.length === 1 ? '' : 's'} — read them</summary>
            <div class="stack-tight">
              ${written.map((step, i) => ui.stepCard(rec.steps[step.key], step, {
                num: i + 1,
                rightHTML: `<a class="chip no-print" href="#/instructor/step/${step.key}">Class ${ui.icon.arrow}</a>`,
              })).join('')}
            </div>
          </details>` : ''}
      </section>`;
  }

  function wire(app) {
    app.on('[data-print]', () => window.print());
  }

  return { render, wire };
}());

if (typeof window !== 'undefined') window.viewBuilder = viewBuilder;

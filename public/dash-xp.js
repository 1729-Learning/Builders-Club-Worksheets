/*
  #/instructor/xp — the leaderboard, and a CSV for the gradebook.

  XP is recomputed from the work rather than read off the student's own running
  total, because a step pays its own XP plus its section's bonus when it is the
  step that finishes the section — 1020 of the 2480 available. Where the two
  disagree you get an `xp mismatch` pill; the app increments its total and never
  recounts it, so a redo, an import or an older version of the worksheets can
  leave it adrift.

  The caveat under the title is permanent, not decoration. Steps that Builders AI
  lets a builder skip pay nothing, so two people at the same point in the course
  can be a couple of hundred XP apart through no fault of either. A leaderboard
  that didn't say so would be quietly lying.
*/
'use strict';

/* eslint-disable no-var */
var viewXp = (function () {
  function rows() {
    return aggregate.buildLeaderboard(store.STATE.records, CURRICULUM);
  }

  function render(app) {
    if (!store.STATE.records.length) {
      return ui.emptyState('Nobody has signed in yet', 'The leaderboard fills itself as students work.', '');
    }
    const list = rows();

    return `
      <div class="stack">
        <div class="page-head"><h1>XP</h1></div>
        <p class="lede">Recomputed from the work itself, out of ${CURRICULUM.maxXp}. Steps that Builders AI
        let someone skip count towards their position in the course but pay no XP, so two builders at the
        same point can be a long way apart here.</p>

        <div class="chips">${ui.chip('Copy CSV', { attr: 'data-xpcsv' })}<span class="mono" id="xpcsv-said"></span></div>

        ${ui.card(`
          <table class="table">
            <thead><tr>
              <th>#</th><th>Builder</th><th class="right">XP</th><th class="right">of max</th>
              <th class="right">Steps</th><th class="right">Artifacts</th>
            </tr></thead>
            <tbody>
              ${list.map(r => `
                <tr>
                  <td class="mono">${r.rank}</td>
                  <td><a href="#/instructor/b/${encodeURIComponent(r.studentId)}">${ui.esc(r.name)}</a>
                      ${r.xpMismatch ? ui.pill('xp mismatch', 'yellow') : ''}</td>
                  <td class="right num">${r.xp}</td>
                  <td class="right">${ui.minibar(r.pct)} <span class="mono">${ui.pct(r.pct)}</span></td>
                  <td class="right num">${r.frontier}/${CURRICULUM.coreStepCount}${r.stepsMastered ? `<span class="mono"> (${r.stepsMastered} skipped)</span>` : ''}</td>
                  <td class="right num">${r.artifacts}/${CURRICULUM.artifactCount}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        `, 'flat')}
      </div>`;
  }

  function wire(app) {
    app.on('[data-xpcsv]', () => {
      const list = rows();
      const text = ui.csv([
        ['Rank', 'Builder', 'XP', 'Max XP', 'Percent', 'Steps done', 'Steps skipped by AI', 'Frontier', 'Core steps', 'Artifacts'],
        ...list.map(r => [r.rank, r.name, r.xp, CURRICULUM.maxXp, Math.round(r.pct * 100),
          r.stepsDone, r.stepsMastered, r.frontier, CURRICULUM.coreStepCount, r.artifacts]),
      ]);
      const said = document.getElementById('xpcsv-said');
      ui.copyText(text)
        .then(() => { if (said) said.textContent = 'Copied ✓'; })
        // A blocked clipboard shouldn't cost you the export.
        .catch(() => ui.download('builders-club-xp.csv', text, 'text/csv;charset=utf-8'));
    });
  }

  return { render, wire };
}());

if (typeof window !== 'undefined') window.viewXp = viewXp;

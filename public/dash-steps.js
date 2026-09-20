/*
  #/instructor/steps — the curriculum on the left, detail on the right.

  The rail lists the curriculum in order: worksheets open into sections, sections
  into steps, each with a bar that fills as the class finishes it. Clicking
  anything loads it on the right — a section shows its steps and where the class
  is inside it; a step shows who has finished it, how many tries it took, and
  every answer, in the worksheet's own frame.

  Master–detail rather than a table because the question is never "show me all 63
  rows", it is "how did the class do on THIS one" — and the rail keeps the answer
  to "where does it sit in the course" on screen while you read.
*/
'use strict';

/* eslint-disable no-var */
var viewSteps = (function () {
  let answerSort = 'name';

  const records = () => store.STATE.records;

  /* What fraction of the people who could have done it, have. */
  function sectionProgress(sec, stats) {
    let done = 0, possible = 0;
    for (const step of sec.steps) {
      const s = stats.get(step.key);
      done += s.completed + s.mastered;
      possible += s.classSize;
    }
    return possible ? done / possible : 0;
  }

  function render(app, sel, answers) {
    const recs = records();
    if (!recs.length) {
      return ui.emptyState('Nobody has signed in yet', 'Once students start working, this is where you find the step the class is failing.', '');
    }
    const stats = aggregate.computeStepStats(recs, CURRICULUM);
    const selection = resolve(sel);

    return `
      <div class="stack">
        <div class="page-head"><h1>Assignments</h1></div>
        <div class="panes">
          <div class="rail">${railHTML(stats, selection)}</div>
          <div class="detail">${selection.step ? stepDetail(selection.step, stats, answers) : selection.section ? sectionDetail(selection.section, stats, recs) : overview(stats, recs)}</div>
        </div>
      </div>`;
  }

  function resolve(sel) {
    if (!sel) return {};
    if (sel.stepKey) {
      const step = CURRICULUM.stepByKey(sel.stepKey);
      return step ? { step, section: CURRICULUM.sectionById(step.sectionId) } : {};
    }
    if (sel.sectionId) {
      const section = CURRICULUM.sectionById(sel.sectionId);
      return section ? { section } : {};
    }
    return {};
  }

  /* ---- the rail ---- */

  function railHTML(stats, selection) {
    return CURRICULUM.worksheets.map(w => {
      const openWorksheet = !selection.section || selection.section.worksheetId === w.id || (!selection.section && !w.extra);
      const secs = w.sections;
      let wDone = 0, wPossible = 0;
      for (const sec of secs) for (const step of sec.steps) {
        const s = stats.get(step.key);
        wDone += s.completed + s.mastered; wPossible += s.classSize;
      }
      const frac = wPossible ? wDone / wPossible : 0;

      return `
        <details class="railgroup" ${openWorksheet && !w.extra ? 'open' : ''}>
          <summary>
            <div class="rail-title"><span class="caret">▶</span>${ui.esc(w.title)}</div>
            <div class="rail-sub">${secs.length} sections · ${Math.round(frac * 100)}% done by the class</div>
            <div class="fillbar"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>
          </summary>
          ${secs.map(sec => sectionRail(sec, stats, selection)).join('')}
        </details>`;
    }).join('');
  }

  function sectionRail(sec, stats, selection) {
    const frac = sectionProgress(sec, stats);
    const isOpen = selection.section && selection.section.id === sec.id;
    const finished = stats.get(sec.steps[sec.steps.length - 1].key);
    return `
      <div>
        <a class="railitem ${isOpen && !selection.step ? 'on' : ''}" href="#/instructor/steps/${encodeURIComponent(sec.id)}">
          <span class="railitem-top">
            <span class="railitem-name"><strong>${sec.num}.</strong> ${ui.esc(sec.title)}</span>
            <span class="railitem-n">${Math.round(frac * 100)}%</span>
          </span>
          <span class="fillbar"><i style="width:${(frac * 100).toFixed(1)}%"></i></span>
        </a>
        ${isOpen ? sec.steps.map(step => {
          const s = stats.get(step.key);
          const f = s.classSize ? (s.completed + s.mastered) / s.classSize : 0;
          return `
            <a class="railitem ${selection.step && selection.step.key === step.key ? 'on' : ''}" href="#/instructor/step/${step.key}" style="padding-left:var(--s5)">
              <span class="railitem-top">
                <span class="railitem-name">${ui.esc(step.title)}</span>
                <span class="railitem-n">${s.completed + s.mastered}/${s.classSize}</span>
              </span>
              <span class="fillbar blue"><i style="width:${(f * 100).toFixed(1)}%"></i></span>
            </a>`;
        }).join('') : ''}
      </div>`;
  }

  /* ---- right pane: nothing selected ---- */

  function overview(stats, recs) {
    const hardest = aggregate.hardestSteps(stats, CURRICULUM).slice(0, 5);
    const stalls = aggregate.stallPoints(stats).slice(0, 5);
    return `
      ${ui.card(`
        <div class="card-head"><div class="kicker">Where the class is</div><h2>Pick an assignment on the left</h2></div>
        <p class="lede" style="margin-top:0">Or start with one of these — the steps costing the class the most right now.</p>
      `, 'roomy')}

      ${hardest.length ? ui.card(`
        <div class="card-head"><div class="kicker">Taking the most attempts</div></div>
        <table class="table"><tbody>
          ${hardest.map(h => `<tr>
            <td><a href="#/instructor/step/${h.key}">${ui.esc(h.title)}</a></td>
            <td class="n">${h.medianAttempts} median attempts</td>
            <td class="n">${h.submissions} graded</td>
          </tr>`).join('')}
        </tbody></table>`) : ''}

      ${stalls.length ? ui.card(`
        <div class="card-head"><div class="kicker">People sitting on them now</div></div>
        <table class="table"><tbody>
          ${stalls.map(s => `<tr>
            <td><a href="#/instructor/step/${s.key}">${ui.esc(s.title)}</a></td>
            <td class="n">${s.inProgress} open</td>
            <td class="n">${s.stuck ? ui.pill(s.stuck + ' stuck', 'coral') : ''}</td>
          </tr>`).join('')}
        </tbody></table>`) : ''}
    `;
  }

  /* ---- right pane: a section ---- */

  function sectionDetail(sec, stats, recs) {
    const frac = sectionProgress(sec, stats);
    const artifactStep = sec.steps.find(s => s.isArtifact);
    const finishedIt = artifactStep ? stats.get(artifactStep.key).completed : 0;

    return `
      ${ui.card(`
        <div class="kicker">Section ${sec.num}${sec.weeks ? ` · ${ui.esc(sec.weeks)}` : ''}</div>
        <h2>${ui.esc(sec.title)}</h2>
        ${sec.tagline ? `<p class="lede">${ui.esc(sec.tagline)}</p>` : ''}
        <div class="fillbar lg" style="margin-top:var(--s4)"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>
        <p class="mono" style="margin-top:var(--s2)">${Math.round(frac * 100)}% of all the work in this section is done across the class</p>
      `, 'roomy')}

      ${ui.card(`
        <div class="card-head"><div class="kicker">Steps in this section</div></div>
        <table class="table">
          <thead><tr><th>Step</th><th class="n">Finished</th><th class="n">Attempts</th><th class="n">Open</th></tr></thead>
          <tbody>
            ${sec.steps.map(step => {
              const s = stats.get(step.key);
              return `<tr>
                <td><a href="#/instructor/step/${step.key}">${ui.esc(step.title)}</a><div class="mono">${step.type}${step.isArtifact ? ' · finishes the section' : ''}</div></td>
                <td class="n">${ui.minibar(s.classSize ? s.completed / s.classSize : 0)} ${s.completed} of ${s.reached}</td>
                <td class="n">${s.aiReviewed && s.medianAttempts != null ? s.medianAttempts + ' median' : '<span class="dim">—</span>'}</td>
                <td class="n">${s.inProgress || '<span class="dim">—</span>'}${s.stuckStudentIds.length ? ` ${ui.pill(s.stuckStudentIds.length + ' stuck', 'coral')}` : ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        ${artifactStep ? `<p class="mono" style="margin-top:var(--s3)">${finishedIt} of ${recs.length} have earned ${ui.esc(sec.artifactLabel)}</p>` : ''}
      `)}
    `;
  }

  /* ---- right pane: one step ---- */

  /* `answers` comes from /api/instructor/step/... rather than from the class-wide
     records: this is the one screen that shows what people wrote, so it is the
     one screen that fetches it. Everything else on this page runs on numbers. */
  function stepDetail(step, stats, answers) {
    const s = stats.get(step.key);
    const section = CURRICULUM.sectionById(step.sectionId);
    const all = (answers || []).map(a => ({ id: a.oid, name: a.name || '(unnamed)', st: a.step }));

    let entries = all.filter(e => e.st);
    const notStarted = all.filter(e => !e.st).map(e => e.name);

    if (answerSort === 'attempts') entries.sort((a, b) => (b.st.attempts || 0) - (a.st.attempts || 0));
    else if (answerSort === 'shortest') entries.sort((a, b) => a.st.answerWords - b.st.answerWords);
    else if (answerSort === 'open') entries.sort((a, b) => (a.st.status === 'done' ? 1 : 0) - (b.st.status === 'done' ? 1 : 0));
    else entries.sort((a, b) => a.name.localeCompare(b.name));

    return `
      ${ui.card(`
        <div class="kicker">${sec_label(section)} · ${step.type}${step.xp ? ` · ${step.xp} XP` : ''}</div>
        <h2>${ui.esc(step.title)}</h2>
        <div class="fillbar lg" style="margin:var(--s4) 0 var(--s2)"><i style="width:${(s.classSize ? (s.completed + s.mastered) / s.classSize : 0) * 100}%"></i></div>
        <p class="mono">${s.completed + s.mastered} of ${s.classSize} builders have finished it</p>

        <div class="statrow" style="margin-top:var(--s4)">
          ${ui.stat(s.completed, 'finished', `of ${s.reached} who reached it`, 'green')}
          ${ui.stat(s.inProgress, 'working on it', s.stuckStudentIds.length ? `${s.stuckStudentIds.length} stuck` : 'nobody stuck', s.stuckStudentIds.length ? 'coral' : '')}
          ${ui.stat(s.notReached, 'not here yet', 'ahead of them in the course', '')}
          ${ui.stat(s.aiReviewed && s.medianAttempts != null ? s.medianAttempts : '—', 'median attempts', s.aiReviewed ? `${s.submissions} graded${s.firstSubmissionPassRate != null ? ` · ${ui.pct(s.firstSubmissionPassRate)} first go` : ''}` : 'not AI-graded', s.aiReviewed && s.medianAttempts >= 3 ? 'yellow' : '')}
        </div>
      `, 'roomy')}

      ${ui.card(`
        <div class="card-head"><div class="kicker">The task</div></div>
        <p class="prompt" style="font-size:15px;color:var(--ink)">${ui.esc(step.prompt)}</p>
        ${step.rubric ? `<div class="kicker">What Builders AI checks</div><ul class="rubric">${step.rubric.map(r => `<li>${ui.esc(r)}</li>`).join('')}</ul>` : ''}
      `)}

      ${notStarted.length ? ui.card(`
        <div class="card-head"><div class="kicker">Haven't started it</div><span class="mono">${notStarted.length}</span></div>
        <p style="margin:0">${notStarted.map(n => ui.esc(n)).join(' · ')}</p>
      `) : ''}

      <section class="group" style="margin-top:var(--s5)">
        <div class="group-head">
          <h2>Answers</h2><span class="group-count">${entries.length}</span><span class="group-rule"></span>
          <span class="chips">
            ${[['name', 'Name'], ['attempts', 'Most attempts'], ['shortest', 'Shortest'], ['open', 'Open first']].map(([v, l]) => ui.chip(l, { on: answerSort === v, attr: `data-answersort="${v}"` })).join('')}
          </span>
        </div>
        <div class="stack-tight">${entries.map(e => answerCard(e)).join('')}</div>
      </section>`;
  }

  const sec_label = section => `${section.num}. ${section.title}`;

  function answerCard(e) {
    const st = e.st;
    const stuck = st.status === 'inProgress' && st.attempts >= aggregate.THRESHOLDS.STUCK_ATTEMPTS;
    const cls = st.status === 'done' ? 'is-done' : st.status === 'mastered' ? 'is-mastered' : stuck ? 'is-stuck' : 'is-open';
    const meta = st.status === 'done' ? `passed on attempt ${st.attempts || 1}${st.completedOn ? ` · ${ui.day(st.completedOn)}` : ''} · ${st.answerWords} words`
      : st.status === 'mastered' ? 'skipped by Builders AI · no XP'
      : `${st.attempts} attempt${st.attempts === 1 ? '' : 's'} so far · not accepted yet`;

    return `
      <section class="wstep ${cls}">
        <div class="wstep-head">
          <span class="avatar">${ui.esc(viewClass.initials(e.name))}</span>
          <div style="flex:1 1 auto;min-width:0">
            <h3 class="wstep-title"><a href="#/instructor/b/${encodeURIComponent(e.id)}" style="text-decoration:none">${ui.esc(e.name)}</a></h3>
            <div class="wstep-meta">${ui.esc(meta)}</div>
          </div>
        </div>
        <div class="wstep-body">
          ${st.status === 'mastered'
            ? `<div class="answer empty">${ui.esc(st.masteredReason || 'Skipped by Builders AI.')}</div>`
            : ui.answerBox(st.answer)}
          ${st.inProgressFeedback ? `
            <div class="thread">
              <div class="msg agent bad"><span class="msg-avatar">↺</span>
                <div class="msg-body"><div class="msg-tag">Builders AI · latest</div><div class="msg-text">${ui.esc(st.inProgressFeedback)}</div></div>
              </div>
            </div>` : ''}
          ${ui.threadHTML(st, { skipLast: st.status === 'inProgress' })}
        </div>
      </section>`;
  }

  function wire(app) {
    app.on('[data-answersort]', el => { answerSort = el.getAttribute('data-answersort'); app.render(); });
  }

  return { render, wire };
}());

if (typeof window !== 'undefined') window.viewSteps = viewSteps;

/*
  The curriculum, projected and indexed for the instructor dashboard.

  content.js is the curriculum as an author writes it: rubrics as one string of
  "- " lines, XP left off wherever the default applies, and nothing that says
  whether an `exercise` is a board or a text box. The dashboard wants the same
  facts in a flat, decided shape — one field per question it asks.

  This used to be a build step that copied content.js into a generated file,
  because the dashboard shipped as a separate repo. Here they are the same app,
  so the projection happens in memory at boot and there is nothing to keep in
  sync. It runs in both the browser and Node, like content.js itself.

  The projection never mutates WORKSHEETS — the student app renders from that
  array, and decorating it with dashboard fields would be a spooky action.

  Pure data in, pure lookups out. No DOM, no state.
*/
'use strict';

var CURRICULUM = (function () {
  /* What awardStepXP in public/app.js falls back to when a step declares no xp.
     Keep in step with the four awardStepXP call sites. */
  const XP_BY_TYPE = { video: 20, journal: 15, board: 15, exercise: 30, synthesis: 30 };

  const fmtClock = sec => {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  };

  /* One field, so no view re-derives the layout from `type` — which doesn't say
     that two of the `exercise` steps are card-sort boards. */
  function answerShape(step) {
    if (step.type === 'video') return 'video';
    if (step.board) return 'board';
    if (step.fields) return 'fields';
    if (step.listAnswer) return 'list';
    return 'text';
  }

  // content.js writes a rubric as one string of "- " lines; every consumer wants
  // a list, and none of them should have to know which shape it arrived in.
  function rubricLines(rubric) {
    if (!rubric) return null;
    const lines = (Array.isArray(rubric) ? rubric : String(rubric).split('\n'))
      .map(l => String(l).replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean);
    return lines.length ? lines : null;
  }

  function boardColumns(step) {
    if (step.board.columns) return step.board.columns.map(c => ({ key: c.id, label: c.label, hint: c.hint || '' }));
    return [
      { key: 'left', label: step.board.left.label, hint: step.board.left.hint || '' },
      { key: 'right', label: step.board.right.label, hint: step.board.right.hint || '' },
    ];
  }

  function project(source) {
    const totals = { worksheets: 0, sections: 0, steps: 0, maxXp: 0, artifactSteps: 0 };
    const worksheets = source.map(w => {
      totals.worksheets++;
      return {
        id: w.id,
        title: w.title,
        subtitle: w.subtitle || '',
        // Extras award no XP at all, so they stay out of every denominator.
        extra: !!w.extra,
        freeRoam: !!w.freeRoam,
        sections: w.sections.map(sec => {
          totals.sections++;
          const bonusXp = w.extra ? 0 : (sec.xp || 0);
          totals.maxXp += bonusXp;
          return {
            id: sec.id,
            num: sec.num,
            title: sec.title,
            kicker: sec.kicker || '',
            weeks: sec.weeks || '',
            tagline: sec.tagline || '',
            bonusXp,                              // banked when this section's artifact step passes
            artifactLabel: sec.artifactLabel || '',
            alwaysUnlocked: !!sec.alwaysUnlocked,
            steps: sec.steps.map(step => {
              totals.steps++;
              if (step.isArtifact) totals.artifactSteps++;
              const xp = w.extra ? 0 : (step.xp || XP_BY_TYPE[step.type] || 0);
              totals.maxXp += xp;
              return {
                id: step.id,
                title: step.title,
                type: step.type,
                prompt: step.prompt || '',
                xp,
                isArtifact: !!step.isArtifact,
                answerShape: answerShape(step),
                masterable: !!step.masteryHint,   // the AI may let a student skip these
                buildsOn: step.buildsOn || null,
                rubric: rubricLines(step.rubric), // shown beside the answers, so the AI's verdicts are auditable
                list: step.listAnswer
                  ? { min: step.listAnswer.min || 0, max: step.listAnswer.max || 0, itemLabel: step.listAnswer.itemLabel || '' }
                  : null,
                fields: step.fields ? step.fields.map(f => ({ id: f.id, label: f.label })) : null,
                board: step.board ? boardColumns(step) : null,
                video: step.video ? {
                  youtubeId: step.video.youtubeId,
                  start: step.video.start,
                  end: step.video.end,
                  startClock: fmtClock(step.video.start),
                  endClock: fmtClock(step.video.end),
                } : null,
              };
            }),
          };
        }),
      };
    });
    return { worksheets, totals };
  }

  function index(data) {
    const worksheets = data.worksheets;
    const worksheetById = new Map();
    const sectionsById = new Map();
    const stepsByKey = new Map();
    const stepOrder = [];       // flat, in curriculum order
    const sectionOrder = [];

    let ordinal = 0;
    for (const w of worksheets) {
      worksheetById.set(w.id, w);
      for (const sec of w.sections) {
        sec.worksheetId = w.id;
        sectionsById.set(sec.id, sec);
        sectionOrder.push(sec.id);
        for (const step of sec.steps) {
          const key = sec.id + '/' + step.id;
          step.key = key;
          step.sectionId = sec.id;
          step.worksheetId = w.id;
          step.ordinal = ordinal++;
          stepsByKey.set(key, step);
          stepOrder.push(key);
        }
      }
    }

    const core = worksheets.filter(w => !w.extra);
    const coreStepKeys = stepOrder.filter(k => !worksheetById.get(stepsByKey.get(k).worksheetId).extra);
    const coreSectionIds = sectionOrder.filter(id => !worksheetById.get(sectionsById.get(id).worksheetId).extra);
    const artifactStepKeys = stepOrder.filter(k => stepsByKey.get(k).isArtifact);

    return {
      data,
      meta: { totals: data.totals },
      totals: data.totals,
      worksheets,

      worksheetById: id => worksheetById.get(id),
      sectionById: id => sectionsById.get(id),
      stepByKey: key => stepsByKey.get(key),
      keyOf: (sectionId, stepId) => sectionId + '/' + stepId,

      stepOrder,
      sectionOrder,
      coreStepKeys,
      coreSectionIds,
      artifactStepKeys,
      core,

      /* The two-layer XP model, which is easy to get wrong: a step pays step.xp,
         and the section's bonus is banked by its artifact step. Steps alone come
         to 1460 of the 2480 — ignoring bonuses undercounts by 41%. Extras pay
         nothing, and a step the AI lets a student skip pays nothing either. */
      xpOfStep: key => (stepsByKey.get(key) ? stepsByKey.get(key).xp : 0),
      bonusOfSection: id => (sectionsById.get(id) ? sectionsById.get(id).bonusXp : 0),
      xpForCompletedStep: key => {
        const step = stepsByKey.get(key);
        if (!step) return 0;
        return step.xp + (step.isArtifact ? sectionsById.get(step.sectionId).bonusXp : 0);
      },
      maxXp: data.totals.maxXp,
      coreStepCount: coreStepKeys.length,
      coreSectionCount: coreSectionIds.length,
      artifactCount: artifactStepKeys.length,

      isExtra: worksheetId => !!(worksheetById.get(worksheetId) || {}).extra,
    };
  }

  // Browser: content.js has already run and defined WORKSHEETS. Node: require it.
  const source = typeof WORKSHEETS !== 'undefined' ? WORKSHEETS : require('./content.js');
  return index(project(source));
}());

if (typeof module !== 'undefined' && module.exports) module.exports = CURRICULUM;
if (typeof window !== 'undefined') window.CURRICULUM = CURRICULUM;

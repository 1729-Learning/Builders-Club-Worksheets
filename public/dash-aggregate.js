/*
  Every number the dashboard shows, derived here and nowhere else.

  Pure functions: records and curriculum in, plain objects out. Nothing reads a
  global, nothing touches the DOM, so each one can be tested against hand-written
  record literals. Records come from lib/records.js; see it for their shape.

  Two rules run through all of it.

  Core only. The three `extra: true` worksheets award no XP by design, so counting
  them would produce a progress figure real effort cannot move. They are reported
  as a separate raw count instead. Denominators are 63 steps, 9 sections,
  9 artifacts, 2480 XP.

  Say what a number measures, or don't show it. Nothing here claims to measure
  time, pace or effort — a completion date is the only clock in the data, and it
  says when something finished, not how long it took. "Behind the median" is a
  position in the cohort at one moment, which is exactly why it is defensible.
  Attempts belong to a STEP, never to a student — three attempts on a hard
  synthesis step is better work than one on an easy exercise, and ranking
  students by it would invert what the program teaches.
*/
'use strict';

/* eslint-disable no-var */
var aggregate = (function () {
  const AI_TYPES = ['exercise', 'synthesis'];       // the only steps an AI ever grades
  const STUCK_ATTEMPTS = 3;                         // rejected this many times = a human should look
  const BEHIND_STEPS = 8;                           // roughly one section behind the middle of the class
  const GATE_CLEARED = 0.7;                         // "most people got past this"
  const COASTING_STEPS = 60;                        // core all but finished
  const MIN_FOR_DIFFICULTY = 3;                     // fewer submissions than this says nothing

  const isAiReviewed = step => AI_TYPES.includes(step.type);

  function median(nums) {
    if (!nums.length) return null;
    const s = nums.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  const mean = nums => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
  const round1 = n => (n == null ? null : Math.round(n * 10) / 10);

  // Stable, readable, and survives a re-import so a bookmarked link still works.
  function studentId(rec) {
    if (rec.rosterId) return rec.rosterId;
    const base = (rec.displayName || rec.fileName || 'builder').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    return base || 'builder';
  }

  /* ---------------------------------------------------------------- one student */

  function computeStudentProgress(rec, curriculum) {
    const perWorksheet = [];
    const sections = [];
    let stepsDone = 0, stepsMastered = 0, stepsInProgress = 0, extraStepsDone = 0;
    let xpEarned = 0, artifactsEarned = 0;
    let furthestStep = null;
    let lastFinished = null;      // the furthest step they actually FINISHED
    let openStep = null;          // and the one they're in the middle of

    for (const w of curriculum.worksheets) {
      let wDone = 0, wMastered = 0, wProgress = 0, wTotal = 0, wXp = 0, wMaxXp = 0;
      for (const sec of w.sections) {
        let sDone = 0, sMastered = 0, sProgress = 0;
        let artifactDone = false;
        for (const step of sec.steps) {
          wTotal++;
          wMaxXp += step.xp + (step.isArtifact ? sec.bonusXp : 0);
          const st = rec.steps[step.key];
          if (!st) continue;
          if (st.status === 'done') {
            sDone++; wDone++;
            if (w.extra) extraStepsDone++;
            else { stepsDone++; xpEarned += curriculum.xpForCompletedStep(step.key); wXp += curriculum.xpForCompletedStep(step.key); }
            if (step.isArtifact) artifactDone = true;
            if (!w.extra && (!furthestStep || step.ordinal > furthestStep.ordinal)) furthestStep = step;
            /* "Most recently finished" by curriculum position, not by date: only
               AI-reviewed steps carry a date at all, so ordering by date would
               skip over every journal and video they did last. */
            if (!w.extra && (!lastFinished || step.ordinal > lastFinished.ordinal)) lastFinished = step;
          } else if (st.status === 'mastered') {
            // Credited as position, never as XP: applyMasteryFlags awards none.
            sMastered++; wMastered++;
            if (!w.extra) stepsMastered++;
            if (!w.extra && (!furthestStep || step.ordinal > furthestStep.ordinal)) furthestStep = step;
          } else if (st.status === 'inProgress') {
            sProgress++; wProgress++;
            if (!w.extra) stepsInProgress++;
            if (!w.extra && (!openStep || step.ordinal < openStep.ordinal)) openStep = step;
            /* A step redone after it had already paid out keeps that XP in the
               student's banked total, so the recompute has to keep it too — it is
               not progress (the step isn't finished), just money already spent. */
            if (!w.extra && st.alreadyEarnedXp) {
              const paid = curriculum.xpForCompletedStep(step.key);
              xpEarned += paid; wXp += paid;
            }
          }
        }

        /* Mirrors the worksheets' own sectionDone(): the artifact step is the gate,
           so the dashboard never disagrees with what the student sees. */
        const credited = sDone + sMastered;
        const hasArtifactStep = sec.steps.some(s => s.isArtifact);
        const state = (hasArtifactStep ? artifactDone : credited === sec.steps.length && credited > 0)
          ? 'done'
          : credited || sProgress ? 'active' : 'notStarted';
        if (state === 'done' && hasArtifactStep && !w.extra) artifactsEarned++;

        sections.push({
          sectionId: sec.id, worksheetId: w.id, num: sec.num, title: sec.title, extra: !!w.extra,
          state, done: sDone, mastered: sMastered, inProgress: sProgress, total: sec.steps.length,
          artifact: rec.artifacts[sec.id] || null, artifactLabel: sec.artifactLabel,
        });
      }
      perWorksheet.push({
        worksheetId: w.id, title: w.title, extra: !!w.extra,
        done: wDone, mastered: wMastered, inProgress: wProgress, total: wTotal,
        pct: wTotal ? (wDone + wMastered) / wTotal : 0,
        xp: wXp, maxXp: wMaxXp,
      });
    }

    const frontier = stepsDone + stepsMastered;
    const xpClaimed = rec.header.xpClaimed || 0;
    const dates = Object.values(rec.steps).map(s => s.completedOn).filter(Boolean).sort();

    return {
      studentId: studentId(rec),
      name: rec.displayName || '(unnamed)',
      perWorksheet, sections,
      stepsDone, stepsMastered, stepsInProgress, extraStepsDone,
      stepsTotal: curriculum.coreStepCount,
      frontier,
      pct: curriculum.coreStepCount ? frontier / curriculum.coreStepCount : 0,
      xpEarned, xpMax: curriculum.maxXp,
      xpClaimed, xpDelta: xpClaimed - xpEarned, xpMismatch: xpClaimed !== 0 && xpClaimed !== xpEarned,
      artifactsEarned, artifactsTotal: curriculum.artifactCount,
      furthestStepKey: furthestStep ? furthestStep.key : null,
      lastFinished: lastFinished ? {
        key: lastFinished.key, title: lastFinished.title,
        sectionNum: curriculum.sectionById(lastFinished.sectionId).num,
        sectionTitle: curriculum.sectionById(lastFinished.sectionId).title,
        completedOn: (rec.steps[lastFinished.key] || {}).completedOn || null,
      } : null,
      openStep: openStep ? {
        key: openStep.key, title: openStep.title,
        attempts: (rec.steps[openStep.key] || {}).attempts || 0,
      } : null,
      lastCompletedOn: dates.length ? dates[dates.length - 1] : null,
      exportedAt: rec.header.exportedAt || null,
      fileDate: rec.header.exportedAt || (rec.lastModified ? new Date(rec.lastModified).toISOString() : null),
      warnings: rec.warnings.filter(w => w.severity !== 'info').length,
      unresolved: rec.unresolved.length,
    };
  }

  /* ---------------------------------------------------------------- one step, whole class */

  function computeStepStats(records, curriculum) {
    const out = new Map();
    for (const key of curriculum.stepOrder) {
      const step = curriculum.stepByKey(key);
      const attemptsOfPassers = [];
      let completed = 0, mastered = 0, inProgress = 0, reached = 0;
      const lengths = [];
      const stuck = [];
      const feedback = [];

      for (const rec of records) {
        const st = rec.steps[key];
        if (!st) continue;
        reached++;
        if (st.status === 'done') {
          completed++;
          lengths.push(st.answerWords);
          if (isAiReviewed(step) && st.accepted && st.attempts > 0) attemptsOfPassers.push(st.attempts);
        } else if (st.status === 'mastered') {
          mastered++;
        } else if (st.status === 'inProgress') {
          inProgress++;
          if (st.attempts >= STUCK_ATTEMPTS) stuck.push(studentId(rec));
          if (st.inProgressFeedback) feedback.push({ studentId: studentId(rec), text: st.inProgressFeedback });
        }
        for (const r of st.rounds || []) if (!r.passed && r.feedback) feedback.push({ studentId: studentId(rec), text: r.feedback });
      }

      const firstTry = attemptsOfPassers.filter(n => n === 1).length;
      out.set(key, {
        key, step,
        sectionId: step.sectionId, worksheetId: step.worksheetId,
        title: step.title, type: step.type, aiReviewed: isAiReviewed(step),
        classSize: records.length,
        completed, mastered, inProgress, reached,
        notReached: records.length - reached,
        // Never a rate over the whole class alone: that conflates "hard" with
        // "nobody has got here yet". Both denominators are reported.
        completionOfClass: records.length ? completed / records.length : 0,
        completionOfReached: reached ? completed / reached : 0,
        // Only meaningful where an AI actually graded the work.
        medianAttempts: isAiReviewed(step) ? median(attemptsOfPassers) : null,
        meanAttempts: isAiReviewed(step) ? round1(mean(attemptsOfPassers)) : null,
        submissions: attemptsOfPassers.length,
        firstSubmissionPassRate: attemptsOfPassers.length ? firstTry / attemptsOfPassers.length : null,
        medianWords: median(lengths),
        stuckStudentIds: stuck,
        rejectionFeedback: feedback,
      });
    }
    return out;
  }

  /* Two different questions, kept apart on purpose. "Hardest" is about how many
     tries the work takes; a step nobody has reached is not hard, it is ahead of
     the class, and blending the two would put a Week 16 section at the top of the
     list every October. */
  function hardestSteps(stats, curriculum, minSubmissions) {
    const min = minSubmissions == null ? MIN_FOR_DIFFICULTY : minSubmissions;
    return [...stats.values()]
      .filter(s => s.aiReviewed && s.submissions >= min && s.medianAttempts != null)
      .sort((a, b) => (b.medianAttempts - a.medianAttempts) || ((1 - b.firstSubmissionPassRate) - (1 - a.firstSubmissionPassRate)))
      .map(s => ({ key: s.key, title: s.title, sectionId: s.sectionId, medianAttempts: s.medianAttempts, meanAttempts: s.meanAttempts, submissions: s.submissions, firstSubmissionPassRate: s.firstSubmissionPassRate, notReached: s.notReached }));
  }

  function stallPoints(stats) {
    return [...stats.values()]
      .filter(s => s.inProgress > 0)
      .sort((a, b) => (b.inProgress - a.inProgress) || (b.stuckStudentIds.length - a.stuckStudentIds.length))
      .map(s => ({ key: s.key, title: s.title, sectionId: s.sectionId, inProgress: s.inProgress, stuck: s.stuckStudentIds.length, reached: s.reached }));
  }

  /* ---------------------------------------------------------------- cohort */

  function buildLeaderboard(records, curriculum) {
    const rows = records.map(rec => {
      const p = computeStudentProgress(rec, curriculum);
      return {
        studentId: p.studentId, name: p.name, xp: p.xpEarned, xpMax: p.xpMax,
        pct: p.xpMax ? p.xpEarned / p.xpMax : 0,
        stepsDone: p.stepsDone, stepsMastered: p.stepsMastered, frontier: p.frontier,
        artifacts: p.artifactsEarned, xpMismatch: p.xpMismatch, rank: 0,
      };
    }).sort((a, b) => (b.xp - a.xp) || (b.frontier - a.frontier) || a.name.localeCompare(b.name));

    // Ties share a rank, and the next rank skips — 1, 1, 3.
    rows.forEach((row, i) => {
      row.rank = i > 0 && rows[i - 1].xp === row.xp && rows[i - 1].frontier === row.frontier ? rows[i - 1].rank : i + 1;
    });
    return rows;
  }

  function buildCohortRollup(records, curriculum, roster) {
    const progress = records.map(r => computeStudentProgress(r, curriculum));
    const frontiers = progress.map(p => p.frontier);
    const rosterActive = (roster || []).filter(r => r.active !== false);
    const matched = new Set(progress.map(p => p.studentId));
    return {
      builders: records.length,
      rosterSize: rosterActive.length,
      missingFiles: rosterActive.filter(r => !matched.has(r.id)).length,
      medianFrontier: frontiers.length ? median(frontiers) : 0,
      medianXp: progress.length ? median(progress.map(p => p.xpEarned)) : 0,
      artifactsEarned: progress.reduce((n, p) => n + p.artifactsEarned, 0),
      stepsCompleted: progress.reduce((n, p) => n + p.stepsDone, 0),
      inProgressSteps: progress.reduce((n, p) => n + p.stepsInProgress, 0),
      withWarnings: progress.filter(p => p.warnings > 0).length,
      unnamed: progress.filter(p => p.name === '(unnamed)').length,
    };
  }

  /* Four independent tests, each shown with the evidence that fired it. Never a
     single blended score — a teacher acts on "3 rejected attempts on step 7",
     not on "risk: 0.72". */
  function buildFlags(records, curriculum, roster, opts) {
    opts = opts || {};
    const flags = [];
    const progress = records.map(r => ({ rec: r, p: computeStudentProgress(r, curriculum) }));
    const med = progress.length ? median(progress.map(x => x.p.frontier)) : 0;
    const stats = computeStepStats(records, curriculum);

    // On the roster, no file in this import. The strongest signal in the data.
    const matched = new Set(progress.map(x => x.p.studentId));
    for (const entry of (roster || []).filter(r => r.active !== false)) {
      if (matched.has(entry.id)) continue;
      flags.push({
        code: 'no-file', tone: 'coral', studentId: entry.id, name: entry.name,
        title: 'No file this week',
        detail: entry.lastSeen ? `Nothing uploaded — last seen at ${entry.lastSeen.xp} XP` : 'Nothing uploaded',
      });
    }

    for (const { rec, p } of progress) {
      // Stuck: trying and failing is exactly where a teacher's time pays off.
      for (const st of Object.values(rec.steps)) {
        if (st.status !== 'inProgress' || st.attempts < STUCK_ATTEMPTS) continue;
        const step = curriculum.stepByKey(st.key);
        flags.push({
          code: 'stuck', tone: 'coral', studentId: p.studentId, name: p.name, stepKey: st.key,
          title: `Stuck on “${step.title}”`,
          detail: `${st.attempts} rejected attempts. Builders AI last said: ${(st.inProgressFeedback || '').slice(0, 160)}`,
        });
      }

      // Behind on one specific thing that most of the class has cleared.
      for (const st of Object.values(rec.steps)) {
        if (st.status !== 'inProgress' || st.attempts >= STUCK_ATTEMPTS) continue;
        const s = stats.get(st.key);
        if (!s || s.reached < 3) continue;
        if (s.completionOfReached >= GATE_CLEARED) {
          flags.push({
            code: 'gate', tone: 'yellow', studentId: p.studentId, name: p.name, stepKey: st.key,
            title: `Held up at “${s.title}”`,
            detail: `${s.completed} of ${s.reached} who reached it have cleared it`,
          });
        }
      }

      if (progress.length >= 3 && p.frontier <= med - BEHIND_STEPS) {
        flags.push({
          code: 'behind', tone: 'yellow', studentId: p.studentId, name: p.name,
          title: `${med - p.frontier} steps behind`,
          detail: `${p.frontier} of ${p.stepsTotal} core steps — behind the class median of ${med}`,
        });
      }

      if (p.frontier >= COASTING_STEPS && p.extraStepsDone === 0) {
        flags.push({
          code: 'coasting', tone: 'blue', studentId: p.studentId, name: p.name,
          title: 'Core nearly done',
          detail: 'Point them at the extras shelf',
        });
      }

      if (opts.weekCutoff && p.fileDate && p.fileDate < opts.weekCutoff) {
        flags.push({
          code: 'stale', tone: 'coral', studentId: p.studentId, name: p.name,
          title: 'File is out of date',
          detail: `Exported ${String(p.fileDate).slice(0, 10)}, before the cutoff`,
        });
      }
    }
    return flags;
  }

  /* Every URL a student put in their "live link" artifact. Used every session, and
     the raw text comes along because that step is freeform and extraction will
     sometimes miss. */
  function liveLinks(records, curriculum) {
    const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+|[\w-]+\.(?:com|org|net|io|app|dev|xyz|co|me|ai|vercel\.app|github\.io)(?:\/[^\s<>()]*)?/gi;
    const out = [];
    for (const rec of records) {
      for (const [sectionId, artifact] of Object.entries(rec.artifacts)) {
        const sec = curriculum.sectionById(sectionId);
        if (!sec || !/live link/i.test(sec.artifactLabel || '')) continue;
        const urls = (artifact.text.match(URL_RE) || []).map(u => u.replace(/[.,)]+$/, ''));
        out.push({ studentId: studentId(rec), name: rec.displayName || rec.fileName, sectionId, urls, text: artifact.text });
      }
    }
    return out;
  }

  return {
    computeStudentProgress, computeStepStats, hardestSteps, stallPoints,
    buildLeaderboard, buildCohortRollup, buildFlags, liveLinks,
    studentId, median, isAiReviewed,
    THRESHOLDS: { STUCK_ATTEMPTS, BEHIND_STEPS, GATE_CLEARED, COASTING_STEPS, MIN_FOR_DIFFICULTY },
  };
}());

if (typeof module !== 'undefined' && module.exports) module.exports = aggregate;
if (typeof window !== 'undefined') window.aggregate = aggregate;

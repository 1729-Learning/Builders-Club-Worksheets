'use strict';
/*
  Builders Club — one student's state.json, as a record the dashboard can read.

  The dashboard's analysis layer (public/dash-aggregate.js) was written against
  files that students downloaded and an instructor re-uploaded. Those files were
  markdown, and markdown threw away almost everything worth analysing: no AI
  feedback, no earlier attempts, no timestamps, no in-progress work. The parser
  that read them reconstructed what it could and reported what it couldn't.

  That parser is gone. The server has the real state, so this module does the
  same job from the authoritative side: it shapes state.json into the record the
  aggregation expects, and derives the handful of fields the parser derived that
  were never about parsing.

  Two deliberate differences from the old parser:

    * A step is kept if it is done, or if there is evidence of work. The old rule
      trusted "in progress" on its own, because a markdown file only mentioned a
      step at all if something had happened to it. Here, merely OPENING a step
      creates a pending entry in state.steps, so an untouched step would look
      like work in progress. Evidence is the gate.

    * Absence still means "not started". Never emit a row for an untouched step:
      every consumer reads `if (!rec.steps[key]) continue`.
*/

const CURRICULUM = require('../curriculum.js');

const isoDay = ms => (ms ? new Date(ms).toISOString().slice(0, 10) : null);
const words = s => String(s || '').split(/\s+/).filter(Boolean).length;

/* The review thread is a flat list of `{role:'user'}` submissions each followed
   by the reviewer's reply. Pair them back up into rounds.

   Offline rounds are dropped. When a review call fails, the app pushes an
   `offline` notice and refunds the attempt, so that exchange never happened as
   far as the student's record is concerned — counting it would inflate every
   "how hard is this step" number with our own downtime. */
function roundsFrom(thread, finalAnswer) {
  const out = [];
  const msgs = Array.isArray(thread) ? thread : [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || m.role !== 'user') continue;
    const reply = msgs[i + 1] && msgs[i + 1].role === 'agent' ? msgs[i + 1] : null;
    if (reply && reply.kind === 'offline') continue;
    const text = String(m.text || '');
    out.push({
      n: m.attempt || out.length + 1,
      // The final answer is shown once, at the bottom; a round that matches it
      // says so rather than printing the same wall of text twice.
      text: text === finalAnswer ? '' : text,
      sameAsFinal: text === finalAnswer,
      feedback: reply ? String(reply.text || '') : '',
      passed: !!(reply && reply.kind === 'good'),
    });
  }
  return out;
}

function stepRecord(key, st, curStep, mastered) {
  const answer = String(st.answer || '');
  const rounds = roundsFrom(st.thread, answer);
  const watched = Number(st.maxWatched || st.watchedSeconds || 0);

  const done = st.status === 'done';
  const status = mastered && !done ? 'mastered' : done ? 'done' : 'inProgress';

  /* Attempts: what the app counted wins, because it is the number the student
     saw. Rounds are the fallback, and `none` is its own answer — it means the
     step was never graded, which is different from being graded and passed
     first time. Every "hardest step" number keys off this, so the provenance
     travels with it. */
  let attempts = 0;
  let attemptsSource = 'none';
  if (Number(st.attempts) > 0) { attempts = Number(st.attempts); attemptsSource = 'declared'; }
  else if (rounds.length) { attempts = rounds.length; attemptsSource = 'rounds'; }

  const hasEvidence = !!answer.trim() || attempts > 0 || rounds.length > 0 || watched > 0;
  if (status === 'inProgress' && !hasEvidence) return null;

  const ts = status === 'mastered'
    ? (mastered && mastered.ts)
    : (st.doneAt || (st.verdict && st.verdict.ts));

  return {
    key,
    worksheetId: curStep.worksheetId,
    sectionId: curStep.sectionId,
    stepId: curStep.id,
    status,
    answer,
    answerChars: answer.length,
    answerWords: words(answer),
    attempts,
    attemptsSource,
    accepted: !!(st.verdict && st.verdict.pass) || rounds.some(r => r.passed),
    rounds,
    video: curStep.video && watched > 0 ? {
      youtubeId: curStep.video.youtubeId,
      startClock: curStep.video.startClock,
      endClock: curStep.video.endClock,
      watchedSeconds: watched,
      matchesCurriculum: true, // the server reads the same content.js the student watched
    } : null,
    masteredReason: status === 'mastered' ? String((mastered && mastered.reason) || '') : null,
    inProgressFeedback: status === 'inProgress'
      ? (st.lastFeedback || (rounds.length ? rounds[rounds.length - 1].feedback : '') || null)
      : null,
    completedOn: done || status === 'mastered' ? isoDay(ts) : null,
    // A redone step keeps its latch, so the dashboard can explain why finishing
    // it again paid nothing.
    alreadyEarnedXp: !!st.xpAwarded,
  };
}

/* A step id that state remembers but content.js no longer defines — a step that
   was renamed or deleted while someone was part-way through it. A step is
   resolved, or it is reported. It is never dropped. */
function unresolvedFrom(key, st) {
  const answer = String(st.answer || '');
  return {
    kind: 'step',
    key,
    titleInFile: key,
    promptInFile: '',
    answerPreview: answer.slice(0, 200),
    chars: answer.length,
    sectionIdGuess: key.split('/')[0],
  };
}

/* One student → one record. `profile` and `settings` are the sibling files from
   the same folder; both are optional, because a state can exist before either. */
function toRecord({ oid, state, profile, settings }) {
  state = state || {};
  profile = profile || {};
  const steps = state.steps && typeof state.steps === 'object' ? state.steps : {};
  const mastery = state.mastery && typeof state.mastery === 'object' ? state.mastery : {};

  const out = {};
  const unresolved = [];

  // Every key the student has touched, plus every key they have mastered —
  // mastery can be granted for a step they never opened.
  const keys = new Set(Object.keys(steps).concat(Object.keys(mastery)));
  for (const key of keys) {
    const curStep = CURRICULUM.stepByKey(key);
    const st = steps[key] || {};
    if (!curStep) {
      if (String(st.answer || '').trim() || Number(st.attempts) > 0) unresolved.push(unresolvedFrom(key, st));
      continue;
    }
    const rec = stepRecord(key, st, curStep, mastery[key]);
    if (rec) out[key] = rec;
  }

  const artifacts = {};
  for (const [sectionId, text] of Object.entries(state.artifacts || {})) {
    const sec = CURRICULUM.sectionById(sectionId);
    if (!sec) continue;
    artifacts[sectionId] = { label: sec.artifactLabel, labelInFile: sec.artifactLabel, text: String(text || '') };
  }

  const updatedAt = (state.meta && state.meta.updatedAt) || profile.lastSeen || 0;

  return {
    rosterId: oid,
    displayName: profile.name || profile.email || '',
    email: profile.email || '',
    firstSeen: profile.firstSeen || 0,
    lastSeen: profile.lastSeen || 0,
    // The student's own progression setting decides which steps they could even
    // have reached, so the grid needs it to tell "not started" from "not yet
    // unlocked".
    freeRoam: !!(settings && settings.freeRoam),

    header: {
      // `exportedAt` used to mean "when this file was downloaded". Here it is
      // the last save, which is the same question asked of live data.
      exportedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
      exportedText: isoDay(updatedAt) || '',
      lastActiveDay: state.lastActiveDay || null,
      // What the app's own running total says. computeStudentProgress recomputes
      // XP from the work and flags a disagreement: the app increments and never
      // recounts, so the two can genuinely drift.
      xpClaimed: Number(state.xp || 0),
      streakClaimed: Number(state.streak || 0),
      formatVersion: (state.meta && state.meta.version) || 1,
    },

    steps: out,
    artifacts,
    unresolved,
    warnings: [],   // a parse concept; server-side state has no format to be wrong about
    ok: true,
    fatal: null,
  };
}

/* The class-wide view needs every student at once, but not a word of what they
   wrote. Strip the prose and keep the numbers: a class of thirty becomes a
   fetch of a few hundred kilobytes instead of several megabytes, and no
   student's writing travels to a screen that isn't going to show it. */
function digest(rec) {
  const steps = {};
  for (const [key, s] of Object.entries(rec.steps)) {
    steps[key] = {
      status: s.status,
      attempts: s.attempts,
      attemptsSource: s.attemptsSource,
      accepted: s.accepted,
      answerChars: s.answerChars,
      answerWords: s.answerWords,
      completedOn: s.completedOn,
      alreadyEarnedXp: s.alreadyEarnedXp,
      rounds: s.rounds.map(r => ({ n: r.n, passed: r.passed, sameAsFinal: r.sameAsFinal, text: '', feedback: '' })),
      video: s.video,
      // Presence matters (it explains a green-with-a-slash cell); the wording doesn't.
      masteredReason: s.masteredReason === null ? null : '',
      inProgressFeedback: null,
      answer: '',
      key: s.key,
      worksheetId: s.worksheetId,
      sectionId: s.sectionId,
      stepId: s.stepId,
    };
  }
  const artifacts = {};
  for (const [id, a] of Object.entries(rec.artifacts)) {
    artifacts[id] = { label: a.label, labelInFile: a.labelInFile, text: '' };
  }
  // `unresolved` and `warnings` stay arrays — the aggregation counts them itself.
  const unresolved = rec.unresolved.map(u => ({ ...u, answerPreview: '' }));
  return { ...rec, steps, artifacts, unresolved, digest: true };
}

module.exports = { toRecord, digest, roundsFrom };

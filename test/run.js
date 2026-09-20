#!/usr/bin/env node
/*
  The whole test suite. No framework, no dependencies:

    npm test                        # everything
    node test/run.js --only=records # just the checks whose name contains "records"
    node test/run.js --verbose      # name every passing check too

  Every file under test ends with the same dual-export tail content.js uses,
  which is what lets a no-build browser app be tested in plain node.

  Fixtures are built from the real curriculum rather than written out by hand,
  so a mistyped step id cannot make a check pass for the wrong reason. The
  numeric edge cases are hand-built records, because there the literal IS the
  point and a fixture would hide it.
*/
'use strict';

const assert = require('assert');

const CURRICULUM = require('../curriculum.js');
const WORKSHEETS = require('../content.js');
const records = require('../lib/records.js');
const aggregate = require('../public/dash-aggregate.js');
const viewClass = require('../public/dash-class.js');

const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const verbose = process.argv.includes('--verbose');

let pass = 0, fail = 0, skip = 0;
function check(name, fn) {
  if (only && !name.includes(only)) { skip++; return; }
  try {
    fn();
    pass++;
    if (verbose) console.log(`  ok   ${name}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').join('\n       ')}`);
  }
}
const group = name => console.log(`\n${name}`);

const CORE = CURRICULUM.coreStepKeys;
const AI_TYPES = ['exercise', 'synthesis'];

/* ------------------------------------------------------------------ curriculum */

group('curriculum');

check('curriculum totals match the worksheets', () => {
  const t = CURRICULUM.totals;
  assert.strictEqual(t.worksheets, WORKSHEETS.length);
  assert.strictEqual(t.sections, WORKSHEETS.reduce((n, w) => n + w.sections.length, 0));
  assert.strictEqual(t.steps, WORKSHEETS.reduce((n, w) => n + w.sections.reduce((m, s) => m + s.steps.length, 0), 0));
});

check('curriculum core excludes the extras shelf', () => {
  assert.strictEqual(CURRICULUM.coreStepCount, 63);
  assert.strictEqual(CURRICULUM.coreSectionCount, 9);
  assert.strictEqual(CURRICULUM.stepOrder.length - CURRICULUM.coreStepCount, 25, 'the extras');
});

check('curriculum step XP sums to the two-layer total', () => {
  let steps = 0, both = 0;
  for (const k of CORE) { steps += CURRICULUM.xpOfStep(k); both += CURRICULUM.xpForCompletedStep(k); }
  assert.strictEqual(steps, 1460, 'steps alone');
  assert.strictEqual(both - steps, 1020, 'the section bonuses');
  assert.strictEqual(both, CURRICULUM.maxXp);
});

check('curriculum extras award nothing', () => {
  const extras = CURRICULUM.stepOrder.filter(k => CURRICULUM.isExtra(CURRICULUM.stepByKey(k).worksheetId));
  assert.ok(extras.length > 0);
  assert.strictEqual(extras.reduce((n, k) => n + CURRICULUM.xpForCompletedStep(k), 0), 0);
});

check('curriculum artifact steps pay their section bonus', () => {
  for (const k of CURRICULUM.artifactStepKeys) {
    const step = CURRICULUM.stepByKey(k);
    if (CURRICULUM.isExtra(step.worksheetId)) continue;
    const bonus = CURRICULUM.bonusOfSection(step.sectionId);
    assert.ok(bonus > 0, `${k} finishes a section, so its section has a bonus`);
    assert.strictEqual(CURRICULUM.xpForCompletedStep(k), step.xp + bonus);
  }
});

check('curriculum normalizes every rubric to a list of lines', () => {
  const withRubric = CURRICULUM.stepOrder.filter(k => CURRICULUM.stepByKey(k).rubric);
  assert.strictEqual(withRubric.length, 29);
  for (const k of withRubric) {
    const r = CURRICULUM.stepByKey(k).rubric;
    assert.ok(Array.isArray(r) && r.length, k);
    for (const line of r) assert.ok(line && !/^\s*[-*]/.test(line), `"${line}" keeps its bullet`);
  }
});

check('curriculum marks exactly the AI-graded steps as reviewable', () => {
  for (const k of CURRICULUM.stepOrder) {
    const step = CURRICULUM.stepByKey(k);
    assert.strictEqual(!!step.rubric, AI_TYPES.includes(step.type), `${k} (${step.type})`);
    assert.strictEqual(aggregate.isAiReviewed(step), AI_TYPES.includes(step.type));
  }
});

check('curriculum decorates its own copy and never the worksheets', () => {
  const raw = WORKSHEETS[0].sections[0];
  assert.strictEqual(raw.worksheetId, undefined, 'content.js is left alone');
  assert.strictEqual(raw.steps[0].key, undefined);
  assert.strictEqual(raw.steps[0].ordinal, undefined);
  // …while the projection has everything the aggregation reads.
  const step = CURRICULUM.stepByKey(CORE[0]);
  assert.strictEqual(step.ordinal, 0);
  assert.strictEqual(step.key, CORE[0]);
  assert.ok(step.sectionId && step.worksheetId);
});

/* ------------------------------------------------------------------ records

   The adapter turns one state.json into the record the aggregation reads. Most
   of what it does is not copying — it is deciding what counts as work. */

group('records');

const OID = '00000000-0000-4000-8000-000000000001';
const VIDEO = CORE.find(k => CURRICULUM.stepByKey(k).type === 'video');
const GRADED = CORE.find(k => CURRICULUM.stepByKey(k).rubric);
const toRec = (steps, over) => records.toRecord(Object.assign({
  oid: OID,
  state: { meta: { version: 1, updatedAt: 0 }, xp: 0, steps, artifacts: {}, mastery: {} },
  profile: { name: 'Ada Lovelace' },
  settings: {},
}, over || {}));

check('records treat a step that was only opened as no work at all', () => {
  // stepState() in the student app creates this the moment a step is rendered.
  const rec = toRec({ [CORE[0]]: { status: 'pending', answer: '', attempts: 0, thread: [] } });
  assert.deepStrictEqual(Object.keys(rec.steps), [], 'absence is how "not started" is spelled');
});

check('records keep a finished video even though it has no answer', () => {
  const rec = toRec({ [VIDEO]: { status: 'done', answer: '', attempts: 0, thread: [], maxWatched: 130 } });
  assert.strictEqual(rec.steps[VIDEO].status, 'done');
  assert.strictEqual(rec.steps[VIDEO].video.watchedSeconds, 130);
});

check('records keep half-written work that was never submitted', () => {
  const rec = toRec({ [GRADED]: { status: 'pending', answer: 'half a thought', attempts: 0, thread: [] } });
  assert.strictEqual(rec.steps[GRADED].status, 'inProgress');
});

check('records do not count a round the reviewer was offline for', () => {
  const rec = toRec({ [GRADED]: {
    status: 'done', answer: 'final', attempts: 2, xpAwarded: true,
    verdict: { pass: true, ts: 0 },
    thread: [
      { role: 'user', text: 'first go', attempt: 1 },
      { role: 'agent', text: 'not yet' },
      { role: 'user', text: 'second go', attempt: 2 },
      { role: 'agent', kind: 'offline', text: 'reviewer unavailable' },
      { role: 'user', text: 'final', attempt: 3 },
      { role: 'agent', kind: 'good', text: 'Requirements met' },
    ],
  } });
  const rounds = rec.steps[GRADED].rounds;
  assert.strictEqual(rounds.length, 2, 'the offline exchange is not a round');
  assert.strictEqual(rounds[1].passed, true);
  assert.strictEqual(rounds[1].sameAsFinal, true, 'and the final answer is not printed twice');
  assert.strictEqual(rounds[1].text, '');
});

check('records prefer the attempt count the student was shown', () => {
  const thread = [{ role: 'user', text: 'a', attempt: 1 }, { role: 'agent', text: 'no' }];
  const declared = toRec({ [GRADED]: { status: 'pending', answer: 'a', attempts: 5, thread } });
  assert.strictEqual(declared.steps[GRADED].attempts, 5);
  assert.strictEqual(declared.steps[GRADED].attemptsSource, 'declared');

  const inferred = toRec({ [GRADED]: { status: 'pending', answer: 'a', attempts: 0, thread } });
  assert.strictEqual(inferred.steps[GRADED].attempts, 1);
  assert.strictEqual(inferred.steps[GRADED].attemptsSource, 'rounds');

  const never = toRec({ [VIDEO]: { status: 'done', answer: '', attempts: 0, thread: [], maxWatched: 10 } });
  assert.strictEqual(never.steps[VIDEO].attemptsSource, 'none', 'never graded is not "passed first time"');
});

check('records report a step the worksheets no longer define', () => {
  const rec = toRec({ 'gone-section/gone-step': { status: 'done', answer: 'orphaned work', attempts: 1, thread: [] } });
  assert.strictEqual(Object.keys(rec.steps).length, 0);
  assert.strictEqual(rec.unresolved.length, 1, 'resolved, or reported — never dropped');
  assert.strictEqual(rec.unresolved[0].key, 'gone-section/gone-step');
  assert.match(rec.unresolved[0].answerPreview, /orphaned work/);
});

check('records carry mastery for a step that was never opened', () => {
  const rec = records.toRecord({
    oid: OID,
    state: { meta: {}, xp: 0, steps: {}, artifacts: {}, mastery: { [CORE[2]]: { reason: 'Seen already.', ts: 86400000 } } },
    profile: {}, settings: {},
  });
  assert.strictEqual(rec.steps[CORE[2]].status, 'mastered');
  assert.strictEqual(rec.steps[CORE[2]].masteredReason, 'Seen already.');
  assert.strictEqual(rec.steps[CORE[2]].completedOn, '1970-01-02');
});

check('records date a step by doneAt, falling back to the verdict', () => {
  const both = toRec({ [GRADED]: {
    status: 'done', answer: 'x', attempts: 1, thread: [],
    doneAt: Date.parse('2026-03-14T00:00:00Z'), verdict: { pass: true, ts: Date.parse('2026-01-01T00:00:00Z') },
  } });
  assert.strictEqual(both.steps[GRADED].completedOn, '2026-03-14');

  // Work finished before doneAt existed still has its verdict.
  const legacy = toRec({ [GRADED]: {
    status: 'done', answer: 'x', attempts: 1, thread: [], verdict: { pass: true, ts: Date.parse('2026-01-01T00:00:00Z') },
  } });
  assert.strictEqual(legacy.steps[GRADED].completedOn, '2026-01-01');

  const undated = toRec({ [VIDEO]: { status: 'done', answer: '', attempts: 0, thread: [], maxWatched: 5 } });
  assert.strictEqual(undated.steps[VIDEO].completedOn, null, 'no invented date');
});

check('records count the words and characters of an answer', () => {
  const rec = toRec({ [GRADED]: { status: 'done', answer: '  one two  three\nfour ', attempts: 1, thread: [] } });
  assert.strictEqual(rec.steps[GRADED].answerWords, 4);
  assert.strictEqual(rec.steps[GRADED].answerChars, 22);
});

check('records keep the app XP claim beside the work, without trusting it', () => {
  const rec = toRec({ [CORE[0]]: { status: 'done', answer: 'x', attempts: 0, thread: [], maxWatched: 5 } }, {
    state: { meta: {}, xp: 4321, steps: { [CORE[0]]: { status: 'done', answer: 'x', attempts: 0, thread: [], maxWatched: 5 } }, artifacts: {}, mastery: {} },
  });
  assert.strictEqual(rec.header.xpClaimed, 4321);
});

check('records digest keeps every number and drops every word', () => {
  const rec = toRec({ [GRADED]: {
    status: 'done', answer: 'a real answer here', attempts: 2, xpAwarded: true,
    verdict: { pass: true, ts: 0 }, lastFeedback: 'good work',
    thread: [{ role: 'user', text: 'first', attempt: 1 }, { role: 'agent', text: 'no, because' }],
  } });
  const d = records.digest(rec);
  const s = d.steps[GRADED];
  assert.strictEqual(s.answer, '');
  assert.ok(s.rounds.every(r => !r.text && !r.feedback));
  assert.strictEqual(s.inProgressFeedback, null);
  // …and the numbers the class screens run on all survive.
  assert.strictEqual(s.attempts, 2);
  assert.strictEqual(s.status, 'done');
  assert.strictEqual(s.answerWords, rec.steps[GRADED].answerWords);
  assert.strictEqual(s.rounds.length, rec.steps[GRADED].rounds.length);
  assert.ok(Array.isArray(d.unresolved), 'still an array — the aggregation counts it');
  assert.ok(JSON.stringify(d).indexOf('a real answer here') === -1, 'no prose anywhere in the payload');
});

check('records digest still aggregates to the same numbers as the full record', () => {
  const steps = {};
  for (const k of CORE.slice(0, 12)) {
    steps[k] = { status: 'done', answer: 'some work here', attempts: 1, thread: [], xpAwarded: true, maxWatched: 5 };
  }
  const full = toRec(steps);
  const a = aggregate.computeStudentProgress(full, CURRICULUM);
  const b = aggregate.computeStudentProgress(records.digest(full), CURRICULUM);
  assert.strictEqual(a.xpEarned, b.xpEarned);
  assert.strictEqual(a.frontier, b.frontier);
  assert.strictEqual(a.artifactsEarned, b.artifactsEarned);
});

/* ------------------------------------------------------------------ aggregate

   Hand-built records: the numeric edges are clearer as literals than as fixtures. */

group('aggregate');

function rec(name, steps, extra) {
  return Object.assign({
    rosterId: '', displayName: name, email: '', firstSeen: 0, lastSeen: 0, freeRoam: false,
    header: { exportedAt: null, exportedText: '', lastActiveDay: null, xpClaimed: 0, streakClaimed: 0, formatVersion: 1 },
    steps, artifacts: {}, unresolved: [], warnings: [], ok: true, fatal: null,
  }, extra || {});
}
function done(key, over) {
  return Object.assign({
    key, status: 'done', answer: 'an answer of some length', answerChars: 23, answerWords: 5,
    attempts: 1, attemptsSource: 'declared', accepted: true, rounds: [], video: null, masteredReason: null,
    inProgressFeedback: null, completedOn: null, alreadyEarnedXp: false,
  }, over || {});
}

check('aggregate counts a student against core only', () => {
  const steps = {};
  for (const k of CORE.slice(0, 10)) steps[k] = done(k);
  const extraKey = CURRICULUM.stepOrder.find(k => CURRICULUM.isExtra(CURRICULUM.stepByKey(k).worksheetId));
  steps[extraKey] = done(extraKey);
  const p = aggregate.computeStudentProgress(rec('Ada', steps), CURRICULUM);
  assert.strictEqual(p.stepsTotal, 63);
  assert.strictEqual(p.stepsDone, 10);
  assert.strictEqual(p.extraStepsDone, 1);
  let expected = 0;
  for (const k of CORE.slice(0, 10)) expected += CURRICULUM.xpForCompletedStep(k);
  assert.strictEqual(p.xpEarned, expected);
});

check('aggregate never counts a mastered step as XP earned', () => {
  const k = CORE[0];
  const p = aggregate.computeStudentProgress(rec('M', { [k]: done(k, { status: 'mastered' }) }), CURRICULUM);
  assert.strictEqual(p.xpEarned, 0);
  assert.strictEqual(p.stepsMastered, 1);
  assert.strictEqual(p.stepsDone, 0);
  assert.strictEqual(p.frontier, 1, 'credited as position, not as XP');
});

check('aggregate keeps the XP a redone step already paid out', () => {
  const k = CORE.find(x => !CURRICULUM.stepByKey(x).isArtifact);
  const r = rec('Rory', { [k]: done(k, { status: 'inProgress', accepted: false, alreadyEarnedXp: true }) });
  const p = aggregate.computeStudentProgress(r, CURRICULUM);
  assert.strictEqual(p.xpEarned, CURRICULUM.xpForCompletedStep(k), 'XP stays banked');
  assert.strictEqual(p.frontier, 0, 'but it is not progress');
  assert.strictEqual(p.stepsInProgress, 1);
});

check('aggregate reports a claimed-XP mismatch instead of trusting it', () => {
  const r = rec('X', { [CORE[0]]: done(CORE[0]) });
  r.header.xpClaimed = 9999;
  const p = aggregate.computeStudentProgress(r, CURRICULUM);
  assert.strictEqual(p.xpClaimed, 9999);
  assert.notStrictEqual(p.xpDelta, 0);
  assert.strictEqual(p.xpMismatch, true);
});

check('aggregate marks a section done only when its artifact step is done', () => {
  const artifactKey = CURRICULUM.artifactStepKeys[0];
  const sectionId = CURRICULUM.stepByKey(artifactKey).sectionId;
  const sec = CURRICULUM.sectionById(sectionId);
  const partial = {};
  for (const step of sec.steps) if (!step.isArtifact) partial[step.key] = done(step.key);
  const a = aggregate.computeStudentProgress(rec('P', partial), CURRICULUM);
  assert.strictEqual(a.sections.find(s => s.sectionId === sectionId).state, 'active');
  partial[artifactKey] = done(artifactKey);
  const b = aggregate.computeStudentProgress(rec('Q', partial), CURRICULUM);
  assert.strictEqual(b.sections.find(s => s.sectionId === sectionId).state, 'done');
  assert.strictEqual(b.artifactsEarned, 1);
});

check('aggregate step stats separate reached from the whole class', () => {
  const k1 = CORE[0], k2 = CORE[1];
  const rows = [
    rec('A', { [k1]: done(k1, { attempts: 1 }), [k2]: done(k2, { attempts: 3 }) }),
    rec('B', { [k1]: done(k1, { attempts: 2 }) }),
    rec('C', {}),
  ];
  const s1 = aggregate.computeStepStats(rows, CURRICULUM).get(k1);
  assert.strictEqual(s1.completed, 2);
  assert.strictEqual(s1.classSize, 3);
  assert.strictEqual(s1.reached, 2);
  assert.strictEqual(s1.notReached, 1);
});

check('aggregate reports attempts only for AI-reviewed steps', () => {
  const aiKey = CORE.find(k => AI_TYPES.includes(CURRICULUM.stepByKey(k).type));
  const videoKey = CORE.find(k => CURRICULUM.stepByKey(k).type === 'video');
  const rows = [1, 2, 3].map((n, i) => rec('S' + i, {
    [aiKey]: done(aiKey, { attempts: n }),
    [videoKey]: done(videoKey, { attempts: 0, accepted: false }),
  }));
  const stats = aggregate.computeStepStats(rows, CURRICULUM);
  assert.strictEqual(stats.get(aiKey).medianAttempts, 2);
  assert.strictEqual(stats.get(videoKey).medianAttempts, null, 'never graded — not "easy"');
  assert.strictEqual(stats.get(aiKey).firstSubmissionPassRate, 1 / 3);
});

check('aggregate difficulty ranking skips steps nobody has reached', () => {
  const aiKeys = CORE.filter(k => AI_TYPES.includes(CURRICULUM.stepByKey(k).type)).slice(0, 2);
  const rows = [1, 2, 3].map((n, i) => rec('S' + i, { [aiKeys[0]]: done(aiKeys[0], { attempts: n + 1 }) }));
  const hardest = aggregate.hardestSteps(aggregate.computeStepStats(rows, CURRICULUM), CURRICULUM);
  assert.strictEqual(hardest.length, 1, 'only the step with submissions');
  assert.strictEqual(hardest[0].key, aiKeys[0]);
});

check('aggregate stall points rank by who is sitting there now', () => {
  const k = CORE.find(x => AI_TYPES.includes(CURRICULUM.stepByKey(x).type));
  const rows = [
    rec('A', { [k]: done(k, { status: 'inProgress', accepted: false, attempts: 4 }) }),
    rec('B', { [k]: done(k, { status: 'inProgress', accepted: false, attempts: 1 }) }),
    rec('C', { [k]: done(k) }),
  ];
  const stalls = aggregate.stallPoints(aggregate.computeStepStats(rows, CURRICULUM));
  assert.strictEqual(stalls[0].key, k);
  assert.strictEqual(stalls[0].inProgress, 2);
  assert.strictEqual(stalls[0].stuck, 1, 'only the one with three or more tries');
});

check('aggregate leaderboard ranks by XP and shares a rank on a tie', () => {
  const k1 = CORE[0], k2 = CORE[1];
  const rows = aggregate.buildLeaderboard([
    rec('Low', { [k1]: done(k1) }),
    rec('TieA', { [k1]: done(k1), [k2]: done(k2) }),
    rec('TieB', { [k1]: done(k1), [k2]: done(k2) }),
  ], CURRICULUM);
  assert.strictEqual(rows[0].rank, 1);
  assert.strictEqual(rows[1].rank, 1, 'shared rank');
  assert.strictEqual(rows[2].rank, 3, 'rank skips after a tie');
  assert.strictEqual(rows[2].name, 'Low');
});

check('aggregate handles an empty cohort without dividing by zero', () => {
  const roll = aggregate.buildCohortRollup([], CURRICULUM);
  assert.strictEqual(roll.builders, 0);
  assert.strictEqual(roll.medianFrontier, 0);
  assert.deepStrictEqual(aggregate.buildLeaderboard([], CURRICULUM), []);
  assert.strictEqual(aggregate.computeStepStats([], CURRICULUM).get(CORE[0]).completed, 0);
});

check('aggregate flags a stuck step with the feedback that stalled it', () => {
  const k = CORE.find(x => CURRICULUM.stepByKey(x).type === 'exercise');
  const r = rec('Sam', { [k]: done(k, {
    status: 'inProgress', accepted: false, attempts: 4,
    inProgressFeedback: 'still too broad', rounds: [{ n: 4, text: 'x', feedback: 'still too broad', passed: false }],
  }) });
  const stuck = aggregate.buildFlags([r], CURRICULUM).filter(f => f.code === 'stuck');
  assert.strictEqual(stuck.length, 1);
  assert.match(stuck[0].detail, /still too broad/);
});

check('aggregate flags a builder well behind the cohort median', () => {
  const many = {}, few = {};
  for (const k of CORE.slice(0, 30)) many[k] = done(k);
  for (const k of CORE.slice(0, 2)) few[k] = done(k);
  const behind = aggregate
    .buildFlags([rec('Ahead1', many), rec('Ahead2', many), rec('Behind', few)], CURRICULUM)
    .filter(f => f.code === 'behind');
  assert.strictEqual(behind.length, 1);
  assert.match(behind[0].detail, /behind the class median/);
});

check('aggregate flags a builder coasting with the core nearly done', () => {
  const nearly = {};
  for (const k of CORE.slice(0, 61)) nearly[k] = done(k);
  assert.ok(aggregate.buildFlags([rec('Fast', nearly)], CURRICULUM).some(f => f.code === 'coasting'));
});

/* ------------------------------------------------------------------ the grid

   Six colours, and each has to mean one thing. This is the newest code in the
   dashboard and the easiest to get quietly wrong, because a cell that is the
   wrong shade still looks like a working screen. */

group('grid');

const stuckAt = aggregate.THRESHOLDS.STUCK_ATTEMPTS;
const cellFor = (key, r) => viewClass.cellState(key, r, viewClass.reachableKeys(r, CURRICULUM), stuckAt);

check('grid tells a step not yet unlocked from one not yet started', () => {
  const r = rec('Ada', { [CORE[0]]: done(CORE[0]) });
  assert.strictEqual(cellFor(CORE[1], r).state, 'notStarted', 'the next step is open to them');
  const lastCore = CORE[CORE.length - 1];
  assert.strictEqual(cellFor(lastCore, r).state, 'notReached', 'the end of the course is not');
});

check('grid opens everything for a builder on free roam', () => {
  const r = rec('Free', { [CORE[0]]: done(CORE[0]) }, { freeRoam: true });
  assert.strictEqual(cellFor(CORE[CORE.length - 1], r).state, 'notStarted', 'nothing is gated');
});

check('grid separates being stuck from having fought and won', () => {
  const k = CORE.find(x => AI_TYPES.includes(CURRICULUM.stepByKey(x).type));
  const stuck = cellFor(k, rec('S', { [k]: done(k, { status: 'inProgress', accepted: false, attempts: stuckAt }) }));
  assert.deepStrictEqual(stuck, { state: 'stuck', fought: false });

  const won = cellFor(k, rec('W', { [k]: done(k, { attempts: stuckAt }) }));
  assert.deepStrictEqual(won, { state: 'done', fought: true }, 'passed after a fight is still passed');

  const easy = cellFor(k, rec('E', { [k]: done(k, { attempts: 1 }) }));
  assert.deepStrictEqual(easy, { state: 'done', fought: false });

  const trying = cellFor(k, rec('T', { [k]: done(k, { status: 'inProgress', accepted: false, attempts: 1 }) }));
  assert.deepStrictEqual(trying, { state: 'inProgress', fought: false });
});

check('grid colours mastery as progress and marks it a skip', () => {
  const k = CORE[0];
  assert.strictEqual(cellFor(k, rec('M', { [k]: done(k, { status: 'mastered' }) })).state, 'mastered');
});

check('grid unlocks the next section only once the artifact is earned', () => {
  const sec = CURRICULUM.core[0].sections[0];
  const next = CURRICULUM.core[0].sections[1];
  const partial = {};
  for (const step of sec.steps) if (!step.isArtifact) partial[step.key] = done(step.key);
  assert.strictEqual(cellFor(next.steps[0].key, rec('P', partial)).state, 'notReached');
  partial[sec.steps.find(s => s.isArtifact).key] = done(sec.steps.find(s => s.isArtifact).key);
  assert.strictEqual(cellFor(next.steps[0].key, rec('Q', partial)).state, 'notStarted');
});

/* ------------------------------------------------------------------ */

console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}\n`);
process.exit(fail ? 1 : 0);

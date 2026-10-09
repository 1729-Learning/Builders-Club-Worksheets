'use strict';
/*
  Builders Club — instructor approvals.

  When a student is stuck on a step the AI keeps sending back, an instructor
  can pass it for them. The awkward part is that the student's browser owns
  their state: it posts the whole object on every keystroke, so a change made
  on the server alone would be overwritten by whatever tab the student has
  open, the next time they type.

  So every approval is kept twice. It is applied to state.json at once, which
  puts it on the dashboard and covers a student who isn't online. And it is
  listed in approvals.json, which the student cannot write to: any state the
  student posts afterwards that hasn't seen it gets it applied again on the
  way in. "Seen" is recorded in state.approvalsSeen, so once the student's tab
  has picked an approval up, a Redo of that step stays a Redo.

  Pure functions over plain objects; the server does the reading and writing.
*/

// Steps the AI reviews are the steps with a rubric. Videos, journals and the
// unreviewed scoreboard complete themselves, so there is nothing to override.
function isApprovable(step) {
  return !!(step && step.rubric);
}

/* Mirrors the pass branch of the app's own review handler, so an approved
   step looks like a passed one to everything that reads it, with the
   verdict and the thread message saying who passed it. XP follows the app's
   rules: once per step, never for the extras shelf. */
function applyApproval(state, { worksheet, section, step }, approval) {
  const key = section.id + '/' + step.id;
  state.steps = state.steps || {};
  state.artifacts = state.artifacts || {};
  state.approvalsSeen = state.approvalsSeen || {};
  state.approvalsSeen[approval.id] = approval.ts;

  const st = state.steps[key] || (state.steps[key] = { status: 'pending', answer: '', attempts: 0, thread: [] });
  // The student got there on their own in the meantime. Their pass stands.
  if (st.status === 'done') return state;

  if (!Array.isArray(st.thread)) st.thread = [];
  const note = String(approval.note || '').trim();
  st.thread.push({
    role: 'agent', kind: 'good', by: 'instructor', approvalId: approval.id,
    text: '**Approved by your instructor ✓**' + (note ? '\n' + note : ''),
  });
  st.status = 'done';
  st.doneAt = approval.ts;
  st.verdict = { pass: true, ts: approval.ts, by: 'instructor' };

  if (step.isArtifact) state.artifacts[section.id] = st.answer || '';
  if (!(worksheet && worksheet.extra) && !st.xpAwarded) {
    st.xpAwarded = true;
    state.xp = (Number(state.xp) || 0) + (step.xp || 30) + (step.isArtifact ? (section.xp || 0) : 0);
  }
  return state;
}

/* Applies every approval the incoming state hasn't seen yet. Each one is
   applied against the incoming state itself, so applying it a second time to
   a second stale save is still right: XP is added to that save's own total,
   once. Returns how many it applied. */
function mergeApprovals(state, approvals, findStep) {
  const seen = (state && state.approvalsSeen) || {};
  let applied = 0;
  for (const a of approvals || []) {
    if (!a || !a.id || seen[a.id]) continue;
    const [sectionId, stepId] = String(a.key || '').split('/');
    const found = findStep(sectionId, stepId);
    if (!found) continue; // the curriculum moved on since; nothing to apply it to
    applyApproval(state, found, a);
    applied++;
  }
  return applied;
}

module.exports = { isApprovable, applyApproval, mergeApprovals };

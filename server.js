#!/usr/bin/env node
/*
  Builders Club — MVP Worksheet demo server
  Zero-dependency Node server:
    - serves ./public
    - GET/POST /api/state       → persists the single-student state to ./data/state.json
    - POST /api/review          → real AI review of a worksheet step via `claude -p`
    - POST /api/assist          → synthesis draft ("draft from my work") via `claude -p`
  The AI rides the locally logged-in Claude Code subscription. No API keys.
*/
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const WORKSHEETS = require('./content.js');

const PORT = Number(process.env.PORT || 4321);
const REVIEW_BACKEND = (process.env.REVIEW_BACKEND || 'auto').toLowerCase(); // codex | claude | auto (auto prefers codex — ~4x faster)
const REVIEW_MODEL = process.env.REVIEW_MODEL || 'haiku'; // claude backend only
const CODEX_MODEL = process.env.CODEX_MODEL || '';        // codex backend; '' = CLI default
const AI_TIMEOUT_MS = 240_000; // claude reviews run ~60s since CLI 2.1.220 — leave queue headroom

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* ---------------------------------------------------------------- content lookup */

function findStep(sectionId, stepId) {
  for (const worksheet of WORKSHEETS) {
    const section = worksheet.sections.find(s => s.id === sectionId);
    if (!section) continue;
    const step = section.steps.find(st => st.id === stepId);
    if (!step) return null;
    return { worksheet, section, step };
  }
  return null;
}

/* ---------------------------------------------------------------- state on disk */

const DEFAULT_STATE = { meta: { version: 1, updatedAt: 0 }, xp: 0, streak: 0, lastActiveDay: '', steps: {}, artifacts: {}, mastery: {} };

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return JSON.parse(JSON.stringify(DEFAULT_STATE)); }
}

/* Rolling snapshots of state.json (data/backups/), so a stray "redo" or reset is
   always undoable: copy the newest state back over data/state.json and restart.
   At most one snapshot per 5 minutes, newest ~40 kept. Must never break a save. */
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
function backupState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const files = fs.readdirSync(BACKUP_DIR).filter(f => /^state-.*\.json$/.test(f)).sort();
    const newest = files[files.length - 1];
    if (newest && Date.now() - fs.statSync(path.join(BACKUP_DIR, newest)).mtimeMs < 5 * 60_000) return;
    fs.copyFileSync(STATE_FILE, path.join(BACKUP_DIR, `state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    for (const f of files.slice(0, Math.max(0, files.length - 40))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  } catch { /* a failed backup must never block the save itself */ }
}

function writeState(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  backupState();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, STATE_FILE); // atomic — never leaves a half-written state.json
}

/* ---------------------------------------------------------------- claude -p wrapper */

const PERSONA = `You are "Builders AI," the review coach inside Builders Club, an entrepreneurship program for high-school students (16+). You review worksheet answers against a rubric.
Rules:
1. NEVER write or rewrite the answer for the student — hints and questions only.
2. Be Socratic and specific: name each weakness in THEIR words. Save your one sharpest question for the end — after you've named everything.
3. Feedback, not grades — no scores, no letter grades, no percentages.
4. Teen-friendly, never condescending: short sentences, concrete, warm but not gushing, zero corporate jargon.
5. Reference the student's own prior work when it helps them connect ideas.
6. THE RUBRIC DECIDES PASS/FAIL — nothing else. Pass an imperfect answer that meets it. If you want more polish than the rubric asks for, say so as a suggestion inside a PASSING review; wanting it is never a reason to fail.
7. Format for skimming — never a wall of text. Open with ONE short sentence, then put each separate point on its own "- " bullet line. No paragraph longer than 2 sentences.
8. USEFUL beats compliant — always ask "what does this student actually need to hear?" If the real problem is upstream (the idea is far too big to build, it's a solution wearing a problem costume, the premise contradicts their own research), LEAD with that instead of rubric details. Leading with it doesn't mean stopping there.
9. ONE PASS, EVERYTHING — the most important rule when you fail someone. Name every problem you can see, all in this one review. A student who fixes exactly what you named and then hears about a brand-new problem has been failed by you, not by their work. Before you send a failing review, re-read their whole submission and ask: "if they fix ONLY what I have written here, does it pass?" If the answer is no, you are not finished writing.
10. NEVER invent a fault. If you role-play a user, a builder, or anyone else, answer honestly and stay in the world of what they actually wrote. Check that your objection is actually true of their text before you raise it — never reject an option that in fact fits, or a question that in fact works. A manufactured problem is worse than no feedback at all.`;

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    feedback: { type: 'string' },
    reasons: { type: 'array', items: { type: 'string' } },
    hint: { type: 'string' },
    masteryFlags: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'feedback', 'reasons', 'hint', 'masteryFlags'],
};

// codex needs the schema as a file on disk.
const SCHEMA_FILE = path.join(DATA_DIR, 'verdict-schema.json');

let claudeAvailable = false;
let codexAvailable = false;
let claudeVersion = '', codexVersion = '';
let backend = 'claude'; // resolved from the saved setting (or env) + what's installed

function aiAvailable() { return backend === 'codex' ? codexAvailable : claudeAvailable; }

/* -------- user-facing settings (data/settings.json, editable from the UI) */

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}

function writeSettings(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2));
}

// UI choice wins over the env var; 'auto' prefers codex (~4x faster per review).
function resolveBackend() {
  const pref = readSettings().reviewBackend || REVIEW_BACKEND;
  if (pref === 'codex' || pref === 'claude') backend = pref;
  else backend = codexAvailable ? 'codex' : 'claude';
}

function settingsPayload() {
  const s = readSettings();
  return {
    reviewBackend: s.reviewBackend || 'auto',
    freeRoam: !!s.freeRoam,
    active: backend,
    activeAvailable: aiAvailable(),
    engines: {
      codex: { available: codexAvailable, version: codexVersion },
      claude: { available: claudeAvailable, version: claudeVersion },
    },
  };
}

// Serialize every claude spawn: one student, but double-submits and parallel
// assist calls shouldn't race each other (or hammer the machine).
let claudeQueue = Promise.resolve();
function enqueueClaude(fn) {
  const run = claudeQueue.then(fn, fn);
  claudeQueue = run.catch(() => {});
  return run;
}

function spawnClaude(prompt, { jsonSchema = null, appendSystem = PERSONA } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--model', REVIEW_MODEL,
      '--tools', '',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--append-system-prompt', appendSystem,
    ];
    if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema));

    const child = spawn('claude', args, { cwd: __dirname, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, AI_TIMEOUT_MS);

    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 400)}`));
      resolve(out);
    });
    child.stdin.end(prompt);
  });
}

// Codex CLI equivalent: prompt on stdin, final message on stdout (progress goes
// to stderr). No system-prompt flag, so the persona is folded into the prompt.
function spawnCodex(prompt, { schema = false, appendSystem = PERSONA } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['exec', '-', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only'];
    if (CODEX_MODEL) args.push('-m', CODEX_MODEL);
    if (schema) args.push('--output-schema', SCHEMA_FILE);

    const child = spawn('codex', args, { cwd: __dirname, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, AI_TIMEOUT_MS);

    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`codex exited ${code}: ${err.slice(0, 400)}`));
      resolve(out);
    });
    child.stdin.end(appendSystem + '\n\n---\n\n' + prompt);
  });
}

// Codex stdout with --output-schema is the JSON verdict itself.
function extractCodexVerdict(raw) {
  const t = String(raw).trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('no JSON verdict in codex output');
}

function parseEnvelope(raw) {
  const env = JSON.parse(raw);
  if (env.is_error) throw new Error('claude reported an error result');
  return env;
}

// Parse ladder: structured_output → JSON.parse(result) → first {...} block.
function extractVerdict(envelope) {
  if (envelope.structured_output && typeof envelope.structured_output === 'object') return envelope.structured_output;
  const r = envelope.result;
  if (typeof r === 'string') {
    try { return JSON.parse(r); } catch { /* fall through */ }
    const m = r.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  }
  throw new Error('no JSON verdict in claude output');
}

function offlineVerdict(msg) {
  const cli = backend === 'codex' ? 'Codex' : 'Claude Code';
  return {
    pass: false, offline: true,
    feedback: (msg || `The AI reviewer is offline right now — check that ${cli} is installed and logged in on this machine, then try again.`)
      + '\n\nOr hit **📋 Copy for another AI** above to take this whole step into any AI chat and get feedback there.',
    reasons: [], hint: '', masteryFlags: [],
  };
}

async function runVerdict(prompt) {
  return enqueueClaude(async () => {
    try {
      if (backend === 'codex') {
        const raw = await spawnCodex(prompt, { schema: true });
        return normalizeVerdict(extractCodexVerdict(raw));
      }
      const raw = await spawnClaude(prompt, { jsonSchema: VERDICT_SCHEMA });
      return normalizeVerdict(extractVerdict(parseEnvelope(raw)));
    } catch (e) {
      // Older claude CLIs without --json-schema: retry once relying on the prompt's JSON contract.
      if (backend === 'claude' && /json-schema|unknown option/i.test(String(e.message))) {
        try {
          const raw = await spawnClaude(prompt, { jsonSchema: null });
          return normalizeVerdict(extractVerdict(parseEnvelope(raw)));
        } catch (e2) {
          console.error('[review] retry failed:', e2.message);
          return offlineVerdict();
        }
      }
      console.error('[review] failed:', e.message);
      return offlineVerdict(e.message === 'timeout'
        ? 'The AI reviewer took too long to respond. Give it another try in a moment.'
        : undefined);
    }
  });
}

async function runText(prompt) {
  return enqueueClaude(async () => {
    if (backend === 'codex') {
      const raw = await spawnCodex(prompt, { schema: false });
      return String(raw).trim();
    }
    const raw = await spawnClaude(prompt, { jsonSchema: null });
    const env = parseEnvelope(raw);
    return typeof env.result === 'string' ? env.result.trim() : String(env.result);
  });
}

/* ---------------------------------------------------------------- prompt building */

function clip(text, n = 400) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// Digest of everything the student has already gotten accepted IN THIS WORKSHEET,
// for personalization. Cross-worksheet context would mostly be noise.
function priorWorkDigest(state, worksheet, excludeKey) {
  const lines = [];
  for (const section of worksheet.sections) {
    for (const step of section.steps) {
      const key = `${section.id}/${step.id}`;
      if (key === excludeKey) continue;
      const st = state.steps[key];
      if (st && st.status === 'done' && st.answer) {
        lines.push(`- ${section.title} → ${step.title}: ${clip(st.answer)}`);
      }
    }
  }
  for (const section of worksheet.sections) {
    const text = (state.artifacts || {})[section.id];
    if (text) lines.push(`- FINAL ARTIFACT (${section.title}): ${clip(text)}`);
  }
  return lines.length ? lines.join('\n') : '(none yet — this is early work)';
}

// Steps not yet done that carry a masteryHint — candidates for skip flags.
function masteryCandidates(state, worksheet, currentKey) {
  const lines = [];
  for (const section of worksheet.sections) {
    for (const step of section.steps) {
      const key = `${section.id}/${step.id}`;
      if (key === currentKey || !step.masteryHint) continue;
      const st = state.steps[key];
      if (st && (st.status === 'done')) continue;
      if (state.mastery && state.mastery[key]) continue;
      lines.push(`- ${key}: ${step.masteryHint}`);
    }
  }
  return lines.length ? lines.join('\n') : '(none)';
}

// The specific earlier work a step declares it builds on (buildsOn keys are
// global, so this crosses worksheets — unlike the worksheet-scoped digest).
function buildsOnBlock(step, state) {
  const keys = step.buildsOn || [];
  if (!keys.length) return '';
  const parts = keys.map(k => {
    const [sid, stid] = k.split('/');
    const found = findStep(sid, stid);
    if (!found) return null;
    let text = ((state.steps[k] || {}).answer || '').trim();
    if (!text && found.step.isArtifact) text = ((state.artifacts || {})[sid] || '').trim();
    return `### ${found.step.title}\n${text ? clip(text, 700) : "(the student hasn't done this yet)"}`;
  }).filter(Boolean);
  if (!parts.length) return '';
  return `\n## Work this step builds on — review the submission in light of it\n${parts.join('\n\n')}\n`;
}

// The shared middle of every review prompt: step, rubric, prior work, submission.
function buildReviewBody({ worksheet, section, step, answer, attempt, lastFeedback, priorFeedback, state }) {
  const key = `${section.id}/${step.id}`;
  const roleBlock = step.reviewerNote
    ? `\n## Special instructions for this step\n${step.reviewerNote}\n`
    : '';

  // Every note we've already given them, so the bar can't drift between rounds.
  const history = (priorFeedback && priorFeedback.length ? priorFeedback : [lastFeedback])
    .filter(Boolean)
    .map((t, i) => `Round ${i + 1}: ${clip(t, 600)}`)
    .join('\n');

  const attemptBlock = attempt > 1
    ? `This is attempt ${attempt} — they have already revised ${attempt - 1} time(s) for you.

### Everything you have already told them on this step
${history || '(no earlier feedback recorded)'}

### Rules for a repeat review
- Do NOT raise a point they have already fixed.
- If you are about to fail them on something that was ALSO true of their earlier submissions and you never mentioned it, that is a miss on your side, not a fresh failure. Name it as something you should have caught earlier — and if the rubric is otherwise met, pass them anyway.
- Every rubric line met = PASS. After this many rounds, holding out for polish is the wrong call.`
    : 'This is their first attempt.';

  return `Review one step of the "${worksheet.title}" worksheet.

## Step
Section: ${section.title}
Step: ${step.title}
Task the student was given: ${step.prompt}
${roleBlock}
## Rubric — a passing answer must:
${step.rubric}
${buildsOnBlock(step, state)}
## Student's prior accepted work (context to personalize feedback — do NOT re-review it)
${priorWorkDigest(state, worksheet, key)}

## Student's submission
${attemptBlock}
---
${answer}
---`;
}

// Self-contained prompt a student can paste into ANY AI chat when the local
// reviewer is down (or they just prefer their own AI). Persona included, since
// a fresh chat has no system prompt; conversational reply, not JSON.
function buildPortablePrompt(args) {
  const answer = String(args.answer || '').trim();
  const body = buildReviewBody({ ...args, answer: answer || "(the student hasn't written an answer yet — help them figure out where to start, using their prior work)" });
  return `${PERSONA}

${body}

You are chatting directly with the student now. Reply as Builders AI:
1. Open with ONE short sentence: does this meet the rubric yet, or not?
2. Then short "- " bullets, each making one point, using the student's own words. If it doesn't pass: 3-5 bullets covering EVERY problem you found — fixing your list must be enough to pass. If you count more than five, don't write a long checklist; name which piece to redo first and why instead. A role-play, if this step has one, doesn't count against the 3-5.
3. If it doesn't pass yet: end with ONE sharp question, plus one concrete hint (a fill-in-the-blank shape is great).
4. NEVER write or rewrite the answer for them — coach them until their own revision would pass the rubric. If they paste a new version later in this chat, review it the same way.`;
}

// Self-contained practice-interview prompt: the AI plays a realistic interviewee
// from the student's own problem area, then grades the interview on END INTERVIEW.
function buildPracticePrompt({ state }) {
  const get = k => ((state.steps || {})[k] || {}).answer || '';
  const hypothesis = get('problem-statement/problem-hypothesis') || get('problem-statement/transform-2') || '(not written yet — pick any everyday school/club problem area)';
  const questions = get('problem-statement/survey-questions') || '(the student will improvise questions)';

  return `You are helping a high-school student (16+) practice USER INTERVIEWS for an entrepreneurship program. This is a role-play with two phases.

## The student's problem hypothesis (their research target)
${hypothesis}

## The interview questions they drafted
${questions}

## PHASE 1 — the interview (starts immediately)
Become ONE specific, realistic person from that problem area (invent a plausible name, role, and daily routine). Then let the student interview you. Rules:
- Answer like a busy real person: short, concrete, sometimes vague, occasionally off on a tangent. Real people don't hand over insights — good follow-ups have to dig them out.
- Have a real story underneath: specific incidents, workarounds, and costs consistent with their problem area — revealed only when questions genuinely reach for behavior ("tell me about the last time…").
- If they ask a LEADING question, do what real people do: politely agree without adding anything true.
- If they PITCH an idea or ask "would you use…", be polite and vaguely positive — that's the trap leading questions set.
- Stay in character no matter what. Do not coach, do not evaluate, do not break character during the interview.

## PHASE 2 — the debrief (only when the student types END INTERVIEW)
Break character and review how they interviewed — warm, specific, no grades or scores:
- Quote their best question and say why it worked.
- Quote any leading questions or pitches, and show the non-leading rewrite.
- Behavior vs. opinions: did they ask about what you DO, or what you THINK?
- Follow-up depth: name the one answer they should have dug into and the follow-up that was sitting there.
- End with the ONE thing to do differently in their first real interview.

Start now: introduce yourself in character in two lines, then wait for their first question.`;
}

function buildReviewPrompt(args) {
  const key = `${args.section.id}/${args.step.id}`;
  return `${buildReviewBody(args)}

## Upcoming steps you may mark as already-mastered IF this submission plus their prior work clearly demonstrates the skill (be conservative — usually this list stays empty)
${masteryCandidates(args.state, args.worksheet, key)}

Respond with ONLY a JSON object:
{"pass": boolean,
 "feedback": "skimmable, never a wall of text — a teenager reads this on a phone. ONE short opening sentence, then '- ' bullets in the student's own words. If failing: 3-5 coaching bullets, covering EVERY problem you found, so that fixing this list is enough to pass; then end with ONE sharp question about whichever matters most. If you count MORE than five real problems, do NOT write a ten-item checklist — that many misses means the answer needs a rethink, so spend one or two bullets naming which piece to redo first and why, which is itself the complete instruction. If passing: the bullets say what made it work. (a red-team role-play, if this step has one, goes here too and does NOT count against the 3-5 — keep it to one line per question asked)",
 "reasons": ["one short bullet per rubric line; start each with ✓ (met) or ✗ (missed)"],
 "hint": "one concrete nudge toward the most important fix — a fill-in-the-blank shape is great — or empty string if passing",
 "masteryFlags": ["sectionId/stepId"]
}`;
}

function buildDraftPrompt({ section, step, state }) {
  const sources = (step.synthesizesFrom || [])
    .map(id => {
      const st = state.steps[`${section.id}/${id}`];
      const src = section.steps.find(s => s.id === id);
      return st && st.answer ? `### ${src ? src.title : id}\n${st.answer}` : null;
    })
    .filter(Boolean)
    .join('\n\n');

  return `Assemble a FIRST DRAFT of the student's "${step.artifactLabel || section.artifactLabel || step.title}" using ONLY the student's own words and ideas from their prior answers below. Do not add new ideas, examples, or facts of your own. Where their work leaves a gap, write [you decide: what's missing] instead of inventing content. Keep it under ${step.draftWordLimit || 120} words. Plain text only — no JSON, no headers, no preamble like "Here's a draft".

## The student's prior answers
${sources || '(nothing yet)'}

## What the draft must be
${step.prompt}
${step.rubric ? `\nIt will eventually be reviewed against:\n${step.rubric}` : ''}`;
}

/* ---------------------------------------------------------------- http plumbing */

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2_000_000) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  // content.js lives in the demo root (shared with the server); serve it from there.
  const isContent = urlPath === '/content.js';
  const filePath = isContent
    ? path.join(__dirname, 'content.js')
    : path.join(PUBLIC_DIR, urlPath);
  if (!isContent && !filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store', // demo-grade: always serve fresh files after edits
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');

    if (pathname === '/api/state' && req.method === 'GET') return sendJSON(res, 200, readState());

    if (pathname === '/api/state' && req.method === 'POST') {
      const body = await readBody(req);
      body.meta = Object.assign({}, body.meta, { version: 1, updatedAt: Date.now() });
      writeState(body);
      return sendJSON(res, 200, { ok: true });
    }

    if (pathname === '/api/settings' && req.method === 'GET') return sendJSON(res, 200, settingsPayload());

    if (pathname === '/api/settings' && req.method === 'POST') {
      const body = await readBody(req);
      const next = { ...readSettings() };
      if (body.reviewBackend !== undefined) {
        if (!['auto', 'codex', 'claude'].includes(body.reviewBackend)) return sendJSON(res, 400, { error: 'bad backend' });
        next.reviewBackend = body.reviewBackend;
      }
      if (body.freeRoam !== undefined) next.freeRoam = !!body.freeRoam;
      writeSettings(next);
      resolveBackend();
      console.log(`[settings] ${JSON.stringify(next)} → active backend: ${backend}`);
      return sendJSON(res, 200, settingsPayload());
    }

    // Build the copy-into-any-AI prompt. No AI call — works even when the CLI is offline.
    if (pathname === '/api/prompt' && req.method === 'POST') {
      const { sectionId, stepId, answer = '', attempt = 1, lastFeedback = '', priorFeedback = [], kind = 'review' } = await readBody(req);
      const found = findStep(sectionId, stepId);
      if (!found) return sendJSON(res, 404, { error: 'unknown step' });
      const prompt = kind === 'practice'
        ? buildPracticePrompt({ ...found, state: readState() })
        : buildPortablePrompt({ ...found, answer: String(answer), attempt, lastFeedback, priorFeedback, state: readState() });
      return sendJSON(res, 200, { prompt });
    }

    // Hard reset: wipe all student state back to a brand-new worksheet.
    if (pathname === '/api/reset' && req.method === 'POST') {
      writeState(JSON.parse(JSON.stringify(DEFAULT_STATE)));
      console.log('[reset] state wiped to defaults');
      return sendJSON(res, 200, { ok: true });
    }

    if (pathname === '/api/review' && req.method === 'POST') {
      const { sectionId, stepId, answer, attempt = 1, lastFeedback = '', priorFeedback = [] } = await readBody(req);
      const found = findStep(sectionId, stepId);
      if (!found) return sendJSON(res, 404, { error: 'unknown step' });
      if (!answer || !String(answer).trim()) return sendJSON(res, 400, { error: 'empty answer' });
      if (!aiAvailable()) return sendJSON(res, 200, offlineVerdict());
      const prompt = buildReviewPrompt({ ...found, answer: String(answer), attempt, lastFeedback, priorFeedback, state: readState() });
      const verdict = await runVerdict(prompt);
      return sendJSON(res, 200, verdict);
    }

    if (pathname === '/api/assist' && req.method === 'POST') {
      const { sectionId, stepId } = await readBody(req);
      const found = findStep(sectionId, stepId);
      if (!found) return sendJSON(res, 404, { error: 'unknown step' });
      if (!aiAvailable()) return sendJSON(res, 200, { text: '', offline: true });
      try {
        const text = await runText(buildDraftPrompt({ ...found, state: readState() }));
        return sendJSON(res, 200, { text });
      } catch (e) {
        console.error('[assist] failed:', e.message);
        return sendJSON(res, 200, { text: '', offline: true });
      }
    }

    if (pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'not found' });
    return serveStatic(req, res);
  } catch (e) {
    console.error('[server]', e.message);
    return sendJSON(res, 500, { error: 'server error' });
  }
});

// The model sometimes emits literal "\n" instead of real newlines in
// structured output — unescape so bullets actually break lines in the UI.
function realNewlines(s) { return String(s == null ? '' : s).replace(/\\n/g, '\n'); }

function normalizeVerdict(v) {
  return {
    pass: !!v.pass,
    feedback: realNewlines(v.feedback),
    reasons: Array.isArray(v.reasons) ? v.reasons.map(String) : [],
    hint: realNewlines(v.hint),
    masteryFlags: Array.isArray(v.masteryFlags) ? v.masteryFlags.map(String).filter(k => {
      const [sid, stid] = k.split('/');
      return !!findStep(sid, stid);
    }) : [],
  };
}

/* ---------------------------------------------------------------- boot */

try {
  claudeVersion = execFileSync('claude', ['--version'], { timeout: 15_000 }).toString().trim();
  claudeAvailable = true;
} catch { /* not installed */ }
try {
  codexVersion = execFileSync('codex', ['--version'], { timeout: 15_000 }).toString().trim();
  codexAvailable = true;
} catch { /* not installed */ }

// The codex backend reads the verdict schema from disk — keep it fresh, and
// always write it so a runtime switch to codex just works.
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(SCHEMA_FILE, JSON.stringify({ ...VERDICT_SCHEMA, additionalProperties: false }, null, 2));

resolveBackend();

if (aiAvailable()) {
  const detail = backend === 'codex'
    ? `${codexVersion}${CODEX_MODEL ? ` (model: ${CODEX_MODEL})` : ''}`
    : `claude ${claudeVersion} (model: ${REVIEW_MODEL})`;
  console.log(`  AI reviewer: ${detail} ✓  [backend: ${backend}]`);
} else {
  console.log(`  AI reviewer: ${backend} CLI not found — reviews will show a friendly offline notice.`);
}

server.listen(PORT, () => {
  console.log(`\n  Builders Club · MVP Worksheet demo`);
  console.log(`  open http://localhost:${PORT}\n`);
});

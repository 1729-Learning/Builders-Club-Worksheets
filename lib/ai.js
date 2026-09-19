'use strict';
/*
  Builders Club — the AI reviewer, over provider APIs.

  The worksheets used to shell out to the `claude` or `codex` CLI on the
  student's own laptop. Hosted, there is no laptop: reviews run here against the
  Anthropic and OpenAI APIs with keys the instructor sets once, and a student
  never sees or needs one.

  Three limits keep a class of teenagers from turning a shared key into a
  surprise bill, and keep one eager student from starving the rest:
    - a concurrency pool, so N calls run at once and the rest queue;
    - single-flight per student per kind, so a double-click can't double-spend;
    - a per-student daily cap.
  Every failure path returns a friendly verdict rather than an error, because a
  student mid-worksheet should never see a stack trace.
*/

const { PERSONA, VERDICT_SCHEMA, normalizeVerdict } = require('./prompts.js');
const store = require('./store.js');

const REVIEW_BACKEND = (process.env.REVIEW_BACKEND || 'auto').toLowerCase();
const REVIEW_MODEL = process.env.REVIEW_MODEL || 'claude-sonnet-5';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-terra';
const REVIEW_MAX_TOKENS = Number(process.env.REVIEW_MAX_TOKENS || 32000);
const DRAFT_MAX_TOKENS = Number(process.env.DRAFT_MAX_TOKENS || 16000);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 300_000);
const AI_CONCURRENCY = Math.max(1, Number(process.env.AI_CONCURRENCY || 4));
const REVIEW_DAILY_CAP = Number(process.env.REVIEW_DAILY_CAP || 60);

const hasClaudeKey = () => !!process.env.ANTHROPIC_API_KEY;
const hasOpenAIKey = () => !!process.env.OPENAI_API_KEY;

/* ---------------------------------------------------------------- clients */

let _anthropic = null, _openai = null;

function anthropic() {
  if (!_anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    // maxRetries 1, not the default 2: a retry multiplies wall-clock time and a
    // student is watching a spinner.
    _anthropic = new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  }
  return _anthropic;
}

function openai() {
  if (!_openai) {
    const OpenAI = require('openai');
    _openai = new OpenAI({ timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  }
  return _openai;
}

/* ---------------------------------------------------------------- engines */

function engines() {
  return {
    claude: { available: hasClaudeKey(), version: hasClaudeKey() ? REVIEW_MODEL : '' },
    codex: { available: hasOpenAIKey(), version: hasOpenAIKey() ? OPENAI_MODEL : '' },
  };
}

function canChooseEngine() { return hasClaudeKey() && hasOpenAIKey(); }

/* Which engine reviews this student's work. Their saved choice only counts when
   both keys are configured — otherwise there is nothing to choose between, and
   honouring a stale preference would just break reviews. */
function resolveEngine(settings) {
  const pref = ((settings && settings.reviewBackend) || REVIEW_BACKEND || 'auto').toLowerCase();
  if (canChooseEngine()) {
    if (pref === 'codex' || pref === 'claude') return pref;
    const envPref = REVIEW_BACKEND;
    if (envPref === 'codex' || envPref === 'claude') return envPref;
    return 'codex'; // 'auto' preferred codex historically — it was the faster CLI
  }
  if (hasClaudeKey()) return 'claude';
  if (hasOpenAIKey()) return 'codex';
  return null;
}

/* ---------------------------------------------------------------- parsing */

// Providers are asked for strict JSON, but a stray "Here's the verdict:" still
// happens. Parse the whole thing, then fall back to the first {...} block.
function extractJson(text) {
  const t = String(text == null ? '' : text).trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('no JSON verdict in model output');
}

function firstText(message) {
  for (const block of message.content || []) {
    if (block.type === 'text' && block.text) return block.text;
  }
  return '';
}

function logUsage(kind, engine, model, oid, usage, ms, stop) {
  const u = usage || {};
  const inTok = u.input_tokens ?? u.prompt_tokens ?? 0;
  const outTok = u.output_tokens ?? u.completion_tokens ?? 0;
  const cached = u.cache_read_input_tokens ?? 0;
  console.log(`[ai] kind=${kind} engine=${engine} model=${model} student=${String(oid).slice(0, 8)} in=${inTok} cache_read=${cached} out=${outTok} ms=${ms} stop=${stop || ''}`);
}

/* ---------------------------------------------------------------- provider calls */

/* Streaming, not create(): Sonnet 5 thinks adaptively and that thinking counts
   against max_tokens, so the ceiling has to be generous — and a non-streaming
   request with a ceiling that high risks an HTTP timeout before the first byte. */
async function callClaude({ prompt, structured, maxTokens, kind, oid }) {
  const started = Date.now();
  const req = {
    model: REVIEW_MODEL,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  };
  if (structured) req.output_config = { format: { type: 'json_schema', schema: VERDICT_SCHEMA } };

  const msg = await anthropic().messages.stream(req).finalMessage();
  logUsage(kind, 'claude', REVIEW_MODEL, oid, msg.usage, Date.now() - started, msg.stop_reason);

  if (msg.stop_reason === 'refusal') throw new Error('model declined the request');
  const text = firstText(msg);
  if (msg.stop_reason === 'max_tokens' && !text.trim()) throw new Error('response hit max_tokens with no text');
  return text;
}

async function callOpenAI({ prompt, structured, maxTokens, kind, oid }) {
  const started = Date.now();
  const req = {
    model: OPENAI_MODEL,
    instructions: PERSONA,
    input: prompt,
    max_output_tokens: maxTokens,
  };
  if (structured) {
    req.text = { format: { type: 'json_schema', name: 'verdict', schema: VERDICT_SCHEMA, strict: true } };
  }

  const res = await openai().responses.create(req);
  logUsage(kind, 'codex', OPENAI_MODEL, oid, res.usage, Date.now() - started, res.status);

  const text = res.output_text || '';
  if (!text.trim()) throw new Error(`empty response (status ${res.status})`);
  return text;
}

function callProvider(engine, args) {
  return engine === 'codex' ? callOpenAI(args) : callClaude(args);
}

/* ---------------------------------------------------------------- limits */

class BusyError extends Error { constructor() { super('busy'); this.name = 'BusyError'; } }
class CapError extends Error { constructor() { super('daily cap'); this.name = 'CapError'; } }

// Bounded concurrency: everything past AI_CONCURRENCY waits its turn instead of
// piling onto the providers (and our rate limits) all at once.
class Pool {
  constructor(size) { this.size = size; this.active = 0; this.queue = []; }
  run(fn) {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active++;
        Promise.resolve().then(fn).then(resolve, reject).finally(() => {
          this.active--;
          const next = this.queue.shift();
          if (next) next();
        });
      };
      if (this.active < this.size) start(); else this.queue.push(start);
    });
  }
}

const pool = new Pool(AI_CONCURRENCY);
const inflight = new Set(); // `${oid}:${kind}` — one call of each kind per student

async function runAI({ kind, engine, prompt, oid, structured, maxTokens }) {
  const key = `${oid}:${kind}`;
  if (inflight.has(key)) throw new BusyError();
  if (REVIEW_DAILY_CAP > 0 && store.usageToday(oid) >= REVIEW_DAILY_CAP) throw new CapError();

  inflight.add(key);
  try {
    const text = await pool.run(() => callProvider(engine, { prompt, structured, maxTokens, kind, oid }));
    store.bumpUsage(oid, kind);
    return text;
  } finally {
    inflight.delete(key);
  }
}

/* ---------------------------------------------------------------- public API */

const COPY_HINT = '\n\nOr hit **📋 Copy for another AI** above to take this whole step into any AI chat and get feedback there.';

function offlineVerdict(msg) {
  return {
    pass: false, offline: true,
    feedback: (msg || 'The AI reviewer is temporarily unavailable — try again in a minute.') + COPY_HINT,
    reasons: [], hint: '', masteryFlags: [],
  };
}

const CAP_MESSAGE = "You've hit today's review limit. It resets at midnight UTC.";
const BUSY_MESSAGE = 'A review is already running for you — give it a moment, then try again.';

/* Every failure becomes a verdict the student can act on. `status` tells the
   route what to send; the SPA reads the body either way, and an `offline`
   verdict never counts as an attempt against them. */
function verdictForError(e) {
  if (e instanceof BusyError) return { status: 429, verdict: offlineVerdict(BUSY_MESSAGE) };
  if (e instanceof CapError) return { status: 429, verdict: offlineVerdict(CAP_MESSAGE) };

  const name = e && e.name ? e.name : '';
  const status = e && e.status;
  // 401/403/404/400 mean the deployment is misconfigured, not that the student
  // did anything wrong — shout in the logs, stay friendly on screen.
  if (status === 401 || status === 403 || status === 404 || status === 400) {
    console.error('[ai] configuration error — check the API key and model id:', e.message);
  } else {
    console.error('[ai] failed:', name, e && e.message);
  }
  if (name === 'APIConnectionTimeoutError' || /timeout/i.test(String(e && e.message))) {
    return { status: 200, verdict: offlineVerdict('The AI reviewer took too long to respond. Give it another try in a moment.') };
  }
  return { status: 200, verdict: offlineVerdict() };
}

// A review: strict JSON verdict against the step's rubric.
async function runVerdict({ oid, engine, prompt }) {
  if (!engine) return { status: 200, verdict: offlineVerdict('No AI reviewer is set up yet — ask your instructor.') };
  try {
    const text = await runAI({ kind: 'review', engine, prompt, oid, structured: true, maxTokens: REVIEW_MAX_TOKENS });
    return { status: 200, verdict: normalizeVerdict(extractJson(text)) };
  } catch (e) {
    return verdictForError(e);
  }
}

// A synthesis draft: plain prose assembled from the student's own earlier words.
async function runText({ oid, engine, prompt }) {
  if (!engine) return { status: 200, body: { text: '', offline: true } };
  try {
    const text = await runAI({ kind: 'assist', engine, prompt, oid, structured: false, maxTokens: DRAFT_MAX_TOKENS });
    return { status: 200, body: { text: String(text).trim() } };
  } catch (e) {
    const { status } = verdictForError(e);
    return { status, body: { text: '', offline: true } };
  }
}

function describe() {
  const e = engines();
  const parts = [];
  if (e.claude.available) parts.push(`Claude (${REVIEW_MODEL})`);
  if (e.codex.available) parts.push(`OpenAI (${OPENAI_MODEL})`);
  return parts.length ? parts.join(' + ') : 'none configured';
}

module.exports = {
  engines, canChooseEngine, resolveEngine,
  runVerdict, runText, offlineVerdict, describe,
  REVIEW_MODEL, OPENAI_MODEL, REVIEW_DAILY_CAP, AI_CONCURRENCY,
};

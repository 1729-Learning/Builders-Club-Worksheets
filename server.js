#!/usr/bin/env node
/*
  Builders Club — semester worksheets, hosted.

  Serves the single-page app, signs students in with their school Microsoft
  account, keeps one JSON folder per student on disk, and reviews their work
  against each step's rubric using the Anthropic or OpenAI API.

  The pieces live in lib/:
    prompts.js  the review persona and every prompt, as pure functions
    store.js    per-student state, snapshots, settings, profiles, usage
    ai.js       provider calls plus concurrency, single-flight and daily caps
    auth.js     Microsoft sign-in, signed session cookies, CSRF

  Run it locally with: ALLOW_DEV_LOGIN=1 npm start
*/
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

/* Local development convenience: pick up a .env sitting next to this file, the
   way .env.example says we will. This has to happen before the lib/ modules
   load, because they read their settings as they are required. Hosting
   platforms inject real environment variables, which already exist by now and
   are never overwritten. */
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env — normal in production */ }
}

const prompts = require('./lib/prompts.js');
const store = require('./lib/store.js');
const ai = require('./lib/ai.js');
const auth = require('./lib/auth.js');

const PORT = Number(process.env.PORT || 4321);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

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

/* Buffers are concatenated rather than appended to a string: a multi-byte
   character split across two chunks would otherwise decode to replacement
   characters, quietly mangling an accented name or an emoji. */
function readBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// A whole class in one upload is far bigger than any single save.
const ARCHIVE_MAX_BYTES = 64_000_000;

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  // content.js is shared with the server, so it lives in the project root
  // rather than public/ — serve it from there.
  const isContent = urlPath === '/content.js';
  const filePath = isContent ? path.join(__dirname, 'content.js') : path.join(PUBLIC_DIR, urlPath);
  if (!isContent && !filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store', // a worksheet edit goes live the moment it deploys
    });
    res.end(buf);
  });
}

/* ---------------------------------------------------------------- settings payload

   Shape is unchanged from the CLI era so the Settings page keeps working.
   "available" used to mean "that CLI is installed on this laptop"; it now means
   "the instructor configured that API key". canChooseEngine is new: with only
   one key there is nothing to choose, and the page says which engine is active
   instead of offering a picker that can't work. */
function settingsPayload(oid) {
  const saved = store.readSettings(oid);
  const engine = ai.resolveEngine(saved);
  return {
    reviewBackend: saved.reviewBackend || 'auto',
    freeRoam: !!saved.freeRoam,
    active: engine || 'claude',
    activeAvailable: !!engine,
    canChooseEngine: ai.canChooseEngine(),
    engines: ai.engines(),
  };
}

/* ---------------------------------------------------------------- routes */

async function handleApi(req, res, pathname, url) {
  const method = req.method;

  // Who is signed in. Always 200 — the SPA asks this before anything else and a
  // logged-out student is a normal answer, not an error.
  if (pathname === '/api/me' && method === 'GET') {
    return sendJSON(res, 200, auth.mePayload(req, res));
  }

  if (method === 'POST' && !auth.csrfOk(req)) {
    return sendJSON(res, 403, { error: 'bad origin' });
  }

  /* ---- instructor ---- */

  if (pathname === '/api/instructor/students' && method === 'GET') {
    if (!auth.requireInstructor(req, res, sendJSON)) return;
    // It is a roster of students, so instructors browsing their own class don't
    // belong in it. Computed live, so the list follows INSTRUCTOR_EMAILS; the
    // `ins` flag keeps any profile left over from the class-code era out too.
    const students = store.listStudents().filter(s => !s.ins && auth.roleFor(s.email) !== 'instructor');
    return sendJSON(res, 200, { students });
  }

  /* The class archive: every student's work in one file, so a backup exists
     that doesn't depend on the hosting platform's own backup feature. */
  if (pathname === '/api/instructor/archive' && method === 'GET') {
    if (!auth.requireInstructor(req, res, sendJSON)) return;
    const body = JSON.stringify(store.exportArchive());
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Content-Disposition': `attachment; filename="builders-club-class-${stamp}.json"`,
      'Cache-Control': 'no-store',
    });
    return res.end(body);
  }

  if (pathname === '/api/instructor/archive' && method === 'POST') {
    const who = auth.requireInstructor(req, res, sendJSON);
    if (!who) return;
    let archive;
    try { archive = await readBody(req, ARCHIVE_MAX_BYTES); }
    catch { return sendJSON(res, 400, { error: 'that file is too large, or not valid JSON' }); }
    const result = store.importArchive(archive);
    if (!result.ok) return sendJSON(res, 400, { error: result.error });
    console.log(`[restore] ${who.email} restored ${result.restored} student(s) from an archive, ${result.skipped} skipped`);
    return sendJSON(res, 200, result);
  }

  const studentState = pathname.match(/^\/api\/instructor\/students\/([^/]+)\/state$/);
  if (studentState && method === 'GET') {
    if (!auth.requireInstructor(req, res, sendJSON)) return;
    const oid = decodeURIComponent(studentState[1]);
    if (!store.isOid(oid)) return sendJSON(res, 400, { error: 'bad student id' });
    if (!store.studentExists(oid)) return sendJSON(res, 404, { error: 'unknown student' });
    return sendJSON(res, 200, store.readState(oid));
  }

  /* ---- everything below is the signed-in student's own work ---- */

  const user = auth.requireSession(req, res, sendJSON);
  if (!user) return;
  const oid = user.oid;

  if (pathname === '/api/state' && method === 'GET') {
    return sendJSON(res, 200, store.readState(oid));
  }

  if (pathname === '/api/state' && method === 'POST') {
    const body = await readBody(req);
    // Guard against saving something that isn't a state object at all — an
    // error body posted back by a confused client would wipe real work.
    if (!body || typeof body !== 'object' || typeof body.steps !== 'object' || body.steps === null) {
      return sendJSON(res, 400, { error: 'not a worksheet state' });
    }
    body.meta = Object.assign({}, body.meta, { version: 1, updatedAt: Date.now() });
    store.writeState(oid, body);
    store.touchLastSeen(oid);
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/settings' && method === 'GET') {
    return sendJSON(res, 200, settingsPayload(oid));
  }

  if (pathname === '/api/settings' && method === 'POST') {
    const body = await readBody(req);
    const next = { ...store.readSettings(oid) };
    if (body.reviewBackend !== undefined) {
      if (!['auto', 'codex', 'claude'].includes(body.reviewBackend)) return sendJSON(res, 400, { error: 'bad backend' });
      next.reviewBackend = body.reviewBackend;
    }
    if (body.freeRoam !== undefined) next.freeRoam = !!body.freeRoam;
    store.writeSettings(oid, next);
    return sendJSON(res, 200, settingsPayload(oid));
  }

  if (pathname === '/api/backups' && method === 'GET') {
    return sendJSON(res, 200, { backups: store.listBackups(oid) });
  }

  if (pathname === '/api/backups/restore' && method === 'POST') {
    const { file } = await readBody(req);
    if (!store.restoreBackup(oid, file)) return sendJSON(res, 404, { error: 'not found' });
    return sendJSON(res, 200, { ok: true });
  }

  // Hard reset: wipe this student's work back to a brand-new worksheet.
  if (pathname === '/api/reset' && method === 'POST') {
    store.resetState(oid);
    console.log(`[reset] ${user.email} wiped their state`);
    return sendJSON(res, 200, { ok: true });
  }

  // The copy-into-any-AI prompt. No model call, so it works even when every
  // reviewer is down — which is exactly when a student reaches for it.
  if (pathname === '/api/prompt' && method === 'POST') {
    const { sectionId, stepId, answer = '', attempt = 1, lastFeedback = '', priorFeedback = [], kind = 'review' } = await readBody(req);
    const found = prompts.findStep(sectionId, stepId);
    if (!found) return sendJSON(res, 404, { error: 'unknown step' });
    const state = store.readState(oid);
    const prompt = kind === 'practice'
      ? prompts.buildPracticePrompt({ ...found, state })
      : prompts.buildPortablePrompt({ ...found, answer: String(answer), attempt, lastFeedback, priorFeedback, state });
    return sendJSON(res, 200, { prompt });
  }

  if (pathname === '/api/review' && method === 'POST') {
    const { sectionId, stepId, answer, attempt = 1, lastFeedback = '', priorFeedback = [] } = await readBody(req);
    const found = prompts.findStep(sectionId, stepId);
    if (!found) return sendJSON(res, 404, { error: 'unknown step' });
    if (!answer || !String(answer).trim()) return sendJSON(res, 400, { error: 'empty answer' });
    const state = store.readState(oid);
    const prompt = prompts.buildReviewPrompt({ ...found, answer: String(answer), attempt, lastFeedback, priorFeedback, state });
    const { status, verdict } = await ai.runVerdict({ oid, engine: ai.resolveEngine(store.readSettings(oid)), prompt });
    return sendJSON(res, status, verdict);
  }

  if (pathname === '/api/assist' && method === 'POST') {
    const { sectionId, stepId } = await readBody(req);
    const found = prompts.findStep(sectionId, stepId);
    if (!found) return sendJSON(res, 404, { error: 'unknown step' });
    const prompt = prompts.buildDraftPrompt({ ...found, state: store.readState(oid) });
    const { status, body } = await ai.runText({ oid, engine: ai.resolveEngine(store.readSettings(oid)), prompt });
    return sendJSON(res, status, body);
  }

  return sendJSON(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const { pathname } = url;

    /* Railway's health check. No auth: it runs before anyone signs in.
       Reports storage but never fails on it — restarting cannot conjure a
       volume, and a failing health check would only roll back a deploy whose
       configuration the boot check has already refused. */
    if (pathname === '/healthz') return sendJSON(res, 200, { ok: true, storage: store.storageStatus() });

    if (pathname === '/auth/login' && req.method === 'GET') return auth.beginLogin(req, res);
    if (pathname === '/auth/callback' && req.method === 'GET') return auth.finishLogin(req, res, url.searchParams);
    if (pathname === '/auth/logout') return auth.logout(req, res);
    if (pathname === '/auth/dev' && req.method === 'GET') return auth.devLogin(req, res, url.searchParams);

    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, url);

    return serveStatic(req, res);
  } catch (e) {
    console.error('[server]', e.message);
    return sendJSON(res, 500, { error: 'server error' });
  }
});

/* ---------------------------------------------------------------- boot */

auth.validateAuthEnvOrExit();
// Before the port opens, not on the first student's first save.
store.validateStorageOrExit();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Builders Club · semester worksheets`);
  console.log(`  listening on 0.0.0.0:${PORT}`);
  console.log(`  data:        ${store.DATA_DIR}`);
  console.log(`  AI reviewer: ${ai.describe()}`);
  console.log(`  sign-in:     ${auth.describeSignIn()}`);
  console.log('');
});

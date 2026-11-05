'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const activity = require('../public/activity.js');
const records = require('../lib/records.js');
const aggregate = require('../public/dash-aggregate.js');
const curriculum = require('../curriculum.js');

const DAY = 86400000;
const ROOT = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builders-activity-'));
const secret = crypto.randomBytes(32).toString('hex');
const settle = () => new Promise(resolve => setImmediate(resolve));

// Browser events and time are explicit: advancing days cannot manufacture an
// interaction, and tests never wait five real minutes to check the throttle.
function surface() {
  const listeners = new Map();
  return {
    visibilityState: 'visible', focused: true,
    hasFocus() { return this.focused; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, over = {}) {
      for (const fn of listeners.get(type) || []) fn({ type, target: this, isTrusted: true, ...over });
    },
  };
}

function reader(over = {}) {
  const doc = surface(), win = surface();
  let clock = Date.UTC(2026, 10, 4), calls = 0;
  const stop = activity.start({
    doc, win, now: () => clock, eligible: () => true,
    send: () => { calls++; }, ...over,
  });
  return {
    doc, win, stop,
    advance: ms => { clock += ms; },
    get calls() { return calls; },
  };
}

test('activity: an authenticated foreground reader needs no edit or save', async () => {
  const r = reader();
  await settle();
  assert.equal(r.calls, 1);
  r.advance(8 * DAY); // leaving even a focused tab alone is not engagement
  await settle();
  assert.equal(r.calls, 1);
  r.win.emit('focus'); // returning to that same long-lived tab
  await settle();
  assert.equal(r.calls, 2);
  r.stop();
});

test('activity: hidden/unfocused tabs, synthetic events and polling stay quiet', async () => {
  const r = reader();
  await settle();
  r.advance(activity.INTERVAL_MS);
  r.doc.visibilityState = 'hidden';
  for (const type of ['visibilitychange', 'pointerdown', 'keydown', 'wheel', 'touchstart']) r.doc.emit(type);
  r.win.emit('pageshow');
  r.win.emit('focus');
  r.doc.visibilityState = 'visible';
  r.doc.focused = false;
  r.win.emit('focus');
  r.doc.focused = true;
  r.doc.emit('wheel', { isTrusted: false });
  r.win.emit('focus', { target: {} }); // programmatic form-field focus
  r.doc.emit('approvals'); // no poll/response listener
  await settle();
  assert.equal(r.calls, 1);
  r.doc.emit('visibilitychange');
  await settle();
  assert.equal(r.calls, 2);
  r.stop();
});

test('activity: background load and instructor/read-only views do not count', async () => {
  const doc = surface(), win = surface();
  doc.visibilityState = 'hidden';
  let calls = 0;
  const stop = activity.start({ doc, win, eligible: () => true, send: () => { calls++; } });
  await settle();
  assert.equal(calls, 0);
  doc.visibilityState = 'visible';
  win.emit('pageshow'); // includes restored pages from the back/forward cache
  await settle();
  assert.equal(calls, 1);
  stop();
  const r = reader({ eligible: () => false });
  r.win.emit('focus');
  r.doc.emit('keydown');
  await settle();
  assert.equal(r.calls, 0);
  r.stop();
});

test('activity: trusted reading interactions coalesce at five minutes; stop removes listeners', async () => {
  const r = reader();
  await settle();
  r.advance(activity.INTERVAL_MS - 1);
  r.doc.emit('wheel');
  await settle();
  assert.equal(r.calls, 1);
  r.advance(1);
  for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart']) r.doc.emit(type);
  r.win.emit('focus');
  await settle();
  assert.equal(r.calls, 2);
  r.advance(activity.INTERVAL_MS);
  r.doc.emit('keydown');
  await settle();
  assert.equal(r.calls, 3);
  r.stop();
  r.advance(activity.INTERVAL_MS);
  r.win.emit('focus');
  r.doc.emit('wheel');
  await settle();
  assert.equal(r.calls, 3);
});

test('activity: slow and failed requests never create an automatic retry loop', async () => {
  let calls = 0, reject;
  const r = reader({ send: () => { calls++; return new Promise((_, no) => { reject = no; }); } });
  await settle();
  r.advance(activity.INTERVAL_MS);
  r.doc.emit('wheel');
  await settle();
  assert.equal(calls, 1, 'single flight');
  reject(new Error('offline'));
  await settle();
  assert.equal(calls, 1, 'failure alone does not retry');
  r.win.emit('focus');
  await settle();
  assert.equal(calls, 2);
  reject(new Error('expired session'));
  await settle();
  r.doc.emit('wheel');
  await settle();
  assert.equal(calls, 2, 'failed attempts are throttled too');
  r.stop();
});

function student(n) { return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`; }
function folder(oid) { return path.join(dataDir, 'students', oid); }
function profilePath(oid) { return path.join(folder(oid), 'profile.json'); }
function seed(oid, profile, state = { steps: {}, xp: 0 }) {
  fs.mkdirSync(folder(oid), { recursive: true });
  fs.writeFileSync(profilePath(oid), JSON.stringify({ oid, name: 'Reader', email: 'reader@dev.local', ...profile }));
  fs.writeFileSync(path.join(folder(oid), 'state.json'), JSON.stringify(state));
}
function cookie(oid, over = {}) {
  const payload = { oid, name: 'Reader', email: 'reader@dev.local', iat: Date.now() - 15 * DAY, exp: Date.now() + 15 * DAY, ...over };
  const head = 'v1.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  return 'bc_session=' + head + '.' + crypto.createHmac('sha256', secret).update(head).digest('base64url');
}

let child, base, serverLog = '';
before(async () => {
  // Reserve a free local port without making tests depend on the default 4321.
  const reservation = http.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), DATA_DIR: dataDir, SESSION_SECRET: secret,
      NODE_ENV: 'test', ALLOW_DEV_LOGIN: '1', PUBLIC_BASE_URL: base,
      INSTRUCTOR_EMAILS: 'instructor@dev.local', ALLOWED_EMAIL_DOMAINS: '',
      MS_CLIENT_ID: '', MS_CLIENT_SECRET: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
      RAILWAY_ENVIRONMENT: '', RAILWAY_PROJECT_ID: '', RAILWAY_SERVICE_ID: '', RAILWAY_PUBLIC_DOMAIN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server boot timed out: ' + serverLog)), 10000);
    const read = chunk => {
      serverLog += chunk;
      if (serverLog.includes(`listening on 0.0.0.0:${port}`)) { clearTimeout(timeout); resolve(); }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('error', err => { clearTimeout(timeout); reject(err); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`server exited ${code}: ${serverLog}`)); });
  });
});
after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function request(route, session, options = {}) {
  return fetch(base + route, { ...options, headers: { ...(session ? { Cookie: session } : {}), ...options.headers } });
}

test('activity API: a returning 30-day session reads without editing and becomes recently active', async () => {
  const oid = student(1), session = cookie(oid), old = Date.now() - 8 * DAY;
  const state = { meta: { updatedAt: old }, steps: { 'problem-statement/notice': { answer: 'private writing' } }, xp: 42, streak: 2, artifacts: {}, mastery: {} };
  seed(oid, { firstSeen: old - DAY, lastSeen: old }, state);
  const stateBefore = fs.readFileSync(path.join(folder(oid), 'state.json'), 'utf8');
  const settingsPath = path.join(folder(oid), 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ freeRoam: true }));
  const settingsBefore = fs.readFileSync(settingsPath, 'utf8');
  for (const route of ['/api/me', '/api/state', '/api/approvals', '/api/settings']) {
    assert.equal((await request(route, session)).status, 200);
    assert.equal(JSON.parse(fs.readFileSync(profilePath(oid))).lastSeen, old, route + ' is not activity');
  }
  const before = Date.now();
  const doc = surface(), win = surface();
  let response;
  const stop = activity.start({ doc, win, eligible: () => true,
    send: async () => { response = await request('/api/activity', session, { method: 'POST', headers: { Origin: base } }); },
  });
  // The same client tracker used by boot sends only the authenticated POST.
  for (let i = 0; !response && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  stop();
  assert.equal(response?.status, 200);
  const profile = JSON.parse(fs.readFileSync(profilePath(oid)));
  assert.ok(profile.lastSeen >= before && profile.lastSeen <= Date.now());
  assert.equal(profile.firstSeen, old - DAY);
  assert.equal(fs.readFileSync(path.join(folder(oid), 'state.json'), 'utf8'), stateBefore);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), settingsBefore);
  assert.deepEqual(fs.readdirSync(folder(oid)).sort(), ['profile.json', 'settings.json', 'state.json']);
  const instructor = cookie(student(99), { email: 'instructor@dev.local' });
  const roster = await (await request('/api/instructor/class', instructor)).json();
  const digest = roster.students.find(r => r.rosterId === oid);
  assert.equal(digest.lastSeen, profile.lastSeen);
  assert.ok(!JSON.stringify(digest).includes('private writing'));
  assert.equal(digest.header.xpClaimed, 42);
  assert.equal(digest.header.streakClaimed, 2);
});

test('activity API: unsigned, expired and cross-origin requests cannot update activity', async () => {
  const oid = student(2), old = Date.now() - 8 * DAY;
  seed(oid, { lastSeen: old });
  assert.equal((await request('/api/activity', null, { method: 'POST', headers: { Origin: base } })).status, 401);
  assert.equal((await request('/api/activity', cookie(oid, { exp: Date.now() - DAY }), { method: 'POST', headers: { Origin: base } })).status, 401);
  assert.equal((await request('/api/activity', cookie(oid), { method: 'POST', headers: { Origin: 'https://elsewhere.example' } })).status, 403);
  assert.equal((await request('/api/activity', cookie(oid))).status, 404, 'GET never records a visit');
  assert.equal(JSON.parse(fs.readFileSync(profilePath(oid))).lastSeen, old);
});

test('activity API: caller identity wins over supplied ids; instructors cannot touch a student', async () => {
  const oid = student(3), victim = student(4), old = Date.now() - 8 * DAY;
  seed(oid, { lastSeen: old });
  seed(victim, { lastSeen: old });
  assert.equal((await request('/api/activity', cookie(oid), { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ oid: victim, lastSeen: Date.now() + DAY }) })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(profilePath(victim))).lastSeen, old);
  assert.ok(JSON.parse(fs.readFileSync(profilePath(oid))).lastSeen <= Date.now());
  const instructor = student(5);
  seed(instructor, { email: 'instructor@dev.local', lastSeen: old });
  assert.equal((await request('/api/activity', cookie(instructor, { email: 'instructor@dev.local' }), { method: 'POST', headers: { Origin: base } })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(profilePath(instructor))).lastSeen, old);
});

test('activity API: automatic/background state saves do not masquerade as a visit', async () => {
  const oid = student(6), old = Date.now() - 8 * DAY;
  seed(oid, { lastSeen: old });
  assert.equal((await request('/api/state', cookie(oid), { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ steps: {}, xp: 50 }) })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(profilePath(oid))).lastSeen, old);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder(oid), 'state.json'))).xp, 50, 'saving still works');
});

test('activity API: old profiles stay unknown until a real signal; absent profiles are not invented', async () => {
  const oid = student(7);
  seed(oid, {});
  await request('/api/state', cookie(oid));
  assert.equal(JSON.parse(fs.readFileSync(profilePath(oid))).lastSeen, undefined);
  assert.equal((await request('/api/activity', cookie(oid), { method: 'POST', headers: { Origin: base } })).status, 200);
  const profile = JSON.parse(fs.readFileSync(profilePath(oid)));
  assert.ok(profile.lastSeen > 0);
  assert.equal(profile.firstSeen, undefined, 'do not invent earlier visits');
  const absent = student(8);
  await request('/api/activity', cookie(absent), { method: 'POST', headers: { Origin: base } });
  assert.equal(fs.existsSync(profilePath(absent)), false);
});

test('activity store: disk writes coalesce across requests and module restarts, at the exact boundary', () => {
  const previousDir = process.env.DATA_DIR;
  const modulePath = require.resolve('../lib/store.js');
  const originalNow = Date.now;
  let now = originalNow();
  const oid = student(9);
  seed(oid, { lastSeen: now });
  const inode = () => fs.statSync(profilePath(oid)).ino;
  try {
    process.env.DATA_DIR = dataDir;
    Date.now = () => now;
    delete require.cache[modulePath];
    let store = require(modulePath);
    const initial = inode();
    now += activity.INTERVAL_MS - 1;
    store.touchLastSeen(oid);
    assert.equal(inode(), initial, 'persisted throttle survives restart');
    now++;
    store.touchLastSeen(oid);
    assert.notEqual(inode(), initial, 'write at five minutes');
    const written = inode();
    for (let i = 0; i < 20; i++) store.touchLastSeen(oid);
    assert.equal(inode(), written, 'burst writes coalesce');
    delete require.cache[modulePath];
    store = require(modulePath);
    store.touchLastSeen(oid);
    assert.equal(inode(), written, 'restart does not spend another write');
    now += activity.INTERVAL_MS;
    store.touchLastSeen(oid);
    assert.equal(store.readProfile(oid).lastSeen, now);
  } finally {
    Date.now = originalNow;
    if (previousDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDir;
    delete require.cache[modulePath];
  }
});

test('Class Board: seven-day boundary, missing history, and unchanged progress/XP', () => {
  const now = Date.UTC(2026, 10, 4), cutoff = now - 7 * DAY;
  const lastSeenValues = [cutoff - 1, cutoff, cutoff + 1, 0, undefined, null, 'bad', now];
  const students = lastSeenValues.map((lastSeen, i) => records.toRecord({
    oid: student(20 + i), profile: { name: `Reader ${i}`, lastSeen },
    state: { meta: { updatedAt: now }, steps: { [curriculum.coreStepKeys[0]]: { status: 'done', answer: 'my work' } } }, settings: {},
  }));
  const sandbox = {
    module: { exports: {} }, CURRICULUM: curriculum, aggregate,
    store: { STATE: { records: students, roster: { students: [] } } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/dash-class.js'), 'utf8'), sandbox);
  const rows = sandbox.module.exports.buildRows(null, now).rows;
  const byId = new Map(rows.map(r => [r.id, r]));
  assert.equal(byId.get(student(20)).state, 'dormant');
  for (let i = 1; i < students.length; i++) assert.notEqual(byId.get(student(20 + i)).state, 'dormant');
  for (const i of [3, 4, 5, 6]) assert.equal(byId.get(student(20 + i)).activityKnown, false);
  assert.equal(byId.get(student(27)).activityKnown, true);
  for (const row of rows) {
    assert.equal(row.progress.frontier, rows[0].progress.frontier);
    assert.equal(row.progress.stepsDone, 1);
    assert.equal(row.progress.xpEarned, rows[0].progress.xpEarned);
  }
  assert.equal(students[4].lastSeen, 0, 'classification does not fabricate a visit');
});

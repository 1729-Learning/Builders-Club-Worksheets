'use strict';

// Exercise the real browser submission/save code against the real API handler,
// prompt builders and disk store. Only auth, AI and presentation are replaced.
// Controlled gates model slow requests without sleeps or external services.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const WORKSHEETS = require('../content.js');
const prompts = require('../lib/prompts.js');

const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builders-review-'));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
const store = require('../lib/store.js');
if (previousDataDir === undefined) delete process.env.DATA_DIR;
else process.env.DATA_DIR = previousDataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const copy = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
function element(value = '') {
  return { value, disabled: false, focus() {}, classList: { toggle() {}, add() {}, remove() {} } };
}
function surface() {
  const listeners = new Map();
  return {
    visibilityState: 'visible', hidden: false, focused: true,
    hasFocus() { return this.focused; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type) {
      for (const fn of listeners.get(type) || []) fn({ type, target: this, isTrusted: true });
    },
  };
}
const verdict = pass => ({ pass, feedback: pass ? 'Ready to build.' : 'Name your first testers.', reasons: [], hint: '', masteryFlags: [] });

function harness(t, initial = {}) {
  const oid = randomUUID();
  const initialState = { ...copy(store.freshState()), ...copy(initial) };
  store.writeState(oid, initialState);
  const oldActivity = Date.now() - 8 * 86400000;
  fs.writeFileSync(path.join(dataDir, 'students', oid, 'profile.json'), JSON.stringify({ oid, name: 'Reader', lastSeen: oldActivity }));
  const requests = [], reviews = [], controls = [], timers = new Map(), elements = new Map(), latest = new Map();
  const activityControls = [], doc = surface(), win = surface();
  let nextTimer = 0, handler, nextVerdict = verdict(false), aiGate = null, failWrite = false;
  const serverRequire = createRequire(path.join(root, 'server.js'));
  const context = vm.createContext({
    Buffer, URL, __dirname: root, process: { env: {} }, console: { log() {}, error() {} },
    require(name) {
      if (name === 'http') return { createServer(fn) { handler = fn; return { listen() {} }; } };
      if (name === './lib/auth.js') return {
        validateAuthEnvOrExit() {}, csrfOk: () => true, requireSession: () => ({ oid, role: 'student' }),
        mePayload: () => ({ authenticated: true, oid, role: 'student' }),
        requireInstructor: req => req.headers['x-test-instructor'] ? { email: 'teacher@test.local' } : null,
      };
      if (name === './lib/store.js') return {
        ...store, validateStorageOrExit() {},
        writeState(id, state) {
          if (failWrite) { failWrite = false; throw new Error('disk write failed'); }
          store.writeState(id, state);
        },
      };
      if (name === './lib/ai.js') return {
        resolveEngine: () => 'test',
        canChooseEngine: () => false, engines: () => ({}),
        async runVerdict(args) {
          reviews.push({ ...args, persisted: copy(store.readState(oid)) });
          if (aiGate) await aiGate.promise;
          return { status: 200, verdict: nextVerdict };
        },
      };
      return serverRequire(name);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), context);

  async function request(url, opts = {}) {
    requests.push({ url, body: opts.body && JSON.parse(opts.body) });
    const control = url === '/api/state' && opts.method === 'POST' ? controls.shift()
      : url === '/api/activity' ? activityControls.shift() : null;
    if (control && control.before) await control.before.promise;
    if (control && control.failure === 'network') throw new Error('network unavailable');
    if (control && control.failure === 'disk') failWrite = true;
    let response;
    if (control && control.failure && !['network', 'disk'].includes(control.failure)) {
      const mode = control.failure;
      response = new Response(mode === 'malformed' ? '{' : JSON.stringify({ error: 'save failed' }), {
        status: typeof mode === 'number' ? mode : 200,
      });
    } else {
      response = await new Promise((resolve, reject) => {
        const req = Readable.from([Buffer.from(opts.body || '')]);
        req.url = url; req.method = opts.method || 'GET';
        req.headers = opts.headers || {};
        let status;
        const res = { writeHead(code) { status = code; }, end(body) { resolve(new Response(body, { status })); } };
        Promise.resolve(handler(req, res)).catch(reject);
      });
    }
    if (control && control.after) await control.after.promise;
    return response;
  }

  const client = vm.createContext({
    WORKSHEETS, initialState, fetch: request, window: win,
    dashApp: { boot() {} },
    localStorage: { getItem: () => null }, location: { hash: '#/' },
    document: Object.assign(doc, {
      body: element(),
      getElementById: id => elements.get(id) || null,
      querySelector: selector => elements.get(selector) || null,
      querySelectorAll: () => [],
    }),
    setInterval(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    onLatest: (key, html) => latest.set(key, html),
  });
  const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  assert.match(source, /\nboot\(\);\s*$/);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/activity.js'), 'utf8'), client);
  vm.runInContext(source.replace(/\nboot\(\);\s*$/, ''), client);
  vm.runInContext(`
    state = normalizeState(initialState);
    setLatest = onLatest;
    refreshHistory = updateHeader = advanceFocus = route = showStep = wire = showWho = () => {};
    $ = () => ({ innerHTML: '' });
    window.BuildersGears = { gearSVG: () => '', initScrollGears() {} };
    globalThis.app = { saveState, submitReview, saveJournal, stepState, boot, checkApprovals,
      set viewing(student) { viewingAs = student; },
      get state() { return state; }, get pendingSaves() { return savesInFlight; } };
  `, client);
  t.after(async () => { timers.clear(); await settle(); });
  return {
    app: client.app, requests, reviews, latest, doc, win, oldActivity,
    set verdict(value) { nextVerdict = value; },
    holdAI() { aiGate = gate(); return aiGate; },
    controlSave(control) { controls.push(control); },
    controlActivity(control) { activityControls.push(control); },
    saved: () => copy(store.readState(oid)),
    profile: () => store.readProfile(oid),
    async approve(key) {
      const [sectionId, stepId] = key.split('/');
      const response = await request(`/api/instructor/students/${oid}/approve`, {
        method: 'POST', headers: { 'x-test-instructor': '1' }, body: JSON.stringify({ sectionId, stepId, note: 'Ready to build' }),
      });
      assert.equal(response.status, 200, await response.text());
    },
    async idle() { await settle(); },
    async debounce() {
      for (const [id, timer] of timers) if (timer.ms === 500) { timers.delete(id); timer.fn(); }
      await settle();
    },
    input(key, answer) {
      const found = prompts.findStep(...key.split('/'));
      assert.ok(found, key);
      elements.set('ta-' + key.replace(/[^\w-]/g, '_'), element(answer));
      const button = element();
      elements.set(`[data-review="${key}"]`, button);
      return { ...found, button, textarea: elements.get('ta-' + key.replace(/[^\w-]/g, '_')) };
    },
  };
}

const RESEARCH = 'user-needs/research-recall';
const SCENE = 'pitch/pitch-scene';
const OLD = 'OLD RESEARCH: dog walkers lose keys';
const NEW = 'NEW RESEARCH: captains cannot find scrim times';
const SUBMISSION = 'Friday at 9pm, captain Jo checks the empty poll. "Nobody replies," Jo says.';
const accepted = answer => ({ status: 'done', answer, attempts: 0, thread: [], xpAwarded: true });

test('immediate review waits for prerequisite completion to persist', async t => {
  const h = harness(t);
  const slow = gate();
  h.controlSave({ before: slow });
  const prerequisite = h.input('mvp-plan/core-choice', 'CORE JUST COMPLETED: availability grid\nFeatures: grid and RSVP\nOut: automatic scheduling');
  h.app.saveJournal(prerequisite.section, prerequisite.step);
  const dependent = h.input('mvp-plan/testable-version', 'Four captains use the grid; success is three still using it in two weeks.');
  const review = h.app.submitReview(dependent.section, dependent.step);
  await h.idle();
  assert.equal(h.requests.length, 1, 'only the older save may be in flight');
  assert.equal(h.reviews.length, 0);
  slow.release();
  await review;
  assert.equal(h.reviews.length, 1);
  assert.match(h.reviews[0].prompt, /CORE JUST COMPLETED/);
  assert.equal(h.reviews[0].persisted.steps['mvp-plan/core-choice'].status, 'done');
  assert.equal(h.reviews[0].persisted.steps['mvp-plan/testable-version'].attempts, 1);
  assert.equal(h.app.state.xp, prerequisite.step.xp, 'a rejected review adds no XP');
  assert.equal(h.app.state.steps['mvp-plan/testable-version'].status, 'pending');
});

test('review flushes revised research, accepted work and artifacts out of the debounce', async t => {
  const h = harness(t, { steps: { [RESEARCH]: accepted(OLD) }, artifacts: { 'user-needs': 'OLD ARTIFACT' } });
  h.app.state.steps[RESEARCH].answer = NEW;
  h.app.state.artifacts['user-needs'] = 'UPDATED ARTIFACT: captains need availability';
  h.app.saveState();
  const scene = h.input(SCENE, SUBMISSION);
  await h.app.submitReview(scene.section, scene.step);
  assert.equal(h.reviews.length, 1);
  const call = h.reviews[0];
  assert.match(call.prompt, /NEW RESEARCH/);
  assert.match(call.prompt, /UPDATED ARTIFACT/);
  assert.ok(call.prompt.includes(SUBMISSION));
  assert.ok(call.prompt.includes(scene.step.rubric), 'the existing rubric still decides the review');
  assert.ok(!call.prompt.includes(OLD));
  assert.equal(call.persisted.steps[RESEARCH].answer, NEW);
  assert.equal(call.persisted.steps[SCENE].answer, SUBMISSION);
  await h.debounce();
  assert.equal(h.reviews.length, 1, 'background saves never request another review');
});

test('delayed older autosaves cannot overwrite the context saved for review', async t => {
  const h = harness(t, { steps: { [RESEARCH]: accepted(OLD) } });
  const slow = gate();
  h.controlSave({ before: slow });
  const oldSave = h.app.saveState(true);
  await h.idle();
  h.app.state.steps[RESEARCH].answer = 'INTERMEDIATE RESEARCH';
  const middleSave = h.app.saveState(true);
  h.app.state.steps[RESEARCH].answer = NEW;
  h.app.saveState();
  const scene = h.input(SCENE, SUBMISSION);
  const review = h.app.submitReview(scene.section, scene.step);
  await h.idle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.reviews.length, 0);
  slow.release();
  await Promise.all([oldSave, middleSave, review]);
  await h.debounce();
  assert.equal(h.saved().steps[RESEARCH].answer, NEW);
  assert.equal(h.reviews.length, 1);
  assert.match(h.reviews[0].prompt, /NEW RESEARCH/);
  assert.equal(h.app.pendingSaves, 0);
});

test('review waits for the save acknowledgement even after the disk write finishes', async t => {
  const h = harness(t, { steps: { [RESEARCH]: accepted(NEW) } });
  const acknowledgement = gate();
  h.controlSave({ after: acknowledgement });
  const scene = h.input(SCENE, SUBMISSION);
  const review = h.app.submitReview(scene.section, scene.step);
  await h.idle();
  assert.equal(h.saved().steps[SCENE].answer, SUBMISSION);
  assert.equal(h.reviews.length, 0);
  acknowledgement.release();
  await review;
  assert.equal(h.reviews.length, 1);
});

for (const failure of ['network', 'disk', 403, 401, 'malformed', 'unacknowledged']) {
  test(`failed save (${failure}) blocks AI without charging an attempt, and retry recovers`, async t => {
    const h = harness(t, {
      xp: 100, steps: {
        [RESEARCH]: accepted(OLD),
        [SCENE]: { status: 'pending', answer: 'Previous answer', attempts: 3, thread: [{ role: 'agent', text: 'Earlier feedback' }], lastFeedback: 'Earlier feedback' },
      },
    });
    h.app.state.steps[RESEARCH].answer = NEW;
    h.controlSave({ failure });
    const scene = h.input(SCENE, SUBMISSION);
    await h.app.submitReview(scene.section, scene.step);
    const st = h.app.state.steps[SCENE];
    assert.equal(h.requests.filter(r => r.url === '/api/review').length, 0);
    assert.equal(h.reviews.length, 0);
    assert.equal(st.attempts, 3);
    assert.equal(st.status, 'pending');
    assert.equal(st.answer, SUBMISSION);
    assert.equal(st.lastFeedback, 'Earlier feedback');
    assert.equal(st.verdict, undefined);
    assert.equal(st.thread.at(-1).kind, 'offline');
    assert.match(st.thread.at(-1).text, failure === 401 ? /sign-in expired/ : /Couldn’t save your work/);
    assert.equal(h.app.state.xp, 100);
    assert.equal(scene.button.disabled, false);
    assert.equal(scene.textarea.disabled, false);
    assert.equal(h.app.pendingSaves, 0);
    await h.app.submitReview(scene.section, scene.step);
    assert.equal(h.reviews.length, 1);
    assert.equal(st.attempts, 4);
    assert.match(h.reviews[0].prompt, /NEW RESEARCH/);
    assert.match(h.reviews[0].prompt, /Earlier feedback/);
    assert.ok(!h.reviews[0].prompt.includes('Couldn’t save your work'));
  });
}

test('a failed older background save does not poison the required save queue', async t => {
  const h = harness(t, { steps: { [RESEARCH]: accepted(OLD) } });
  h.controlSave({ failure: 'network' });
  const failed = h.app.saveState(true);
  h.app.state.steps[RESEARCH].answer = NEW;
  const scene = h.input(SCENE, SUBMISSION);
  await h.app.submitReview(scene.section, scene.step);
  await failed;
  assert.equal(h.reviews.length, 1);
  assert.match(h.reviews[0].prompt, /NEW RESEARCH/);
});

test('duplicate submissions during saving or AI review make one call and award artifact XP once', async t => {
  const h = harness(t, { xp: 100 });
  const saving = gate(), reviewing = h.holdAI();
  h.controlSave({ before: saving });
  h.verdict = verdict(true);
  const pitch = h.input('pitch/pitch-outline', 'My five-slide pitch outline');
  const first = h.app.submitReview(pitch.section, pitch.step);
  const second = h.app.submitReview(pitch.section, pitch.step);
  await h.idle();
  assert.equal(h.requests.length, 1);
  saving.release();
  await h.idle();
  const third = h.app.submitReview(pitch.section, pitch.step);
  assert.equal(h.reviews.length, 1);
  reviewing.release();
  await Promise.all([first, second, third]);
  await h.idle();
  const st = h.app.state.steps['pitch/pitch-outline'];
  assert.equal(st.attempts, 1);
  assert.equal(st.status, 'done');
  assert.equal(st.verdict.pass, true);
  assert.equal(st.xpAwarded, true);
  assert.equal(h.app.state.artifacts.pitch, st.answer);
  assert.equal(h.app.state.xp, 100 + pitch.step.xp + pitch.section.xp);
  assert.equal(h.saved().steps['pitch/pitch-outline'].status, 'done');
});

test('foreground tracking from boot stays independent of queued saves and AI attempts', async t => {
  const h = harness(t, { steps: { [RESEARCH]: accepted(OLD) } });
  const visiting = gate(), saving = gate();
  h.controlActivity({ before: visiting });
  await h.app.boot();
  await h.idle();
  assert.equal(h.requests.filter(r => r.url === '/api/activity').length, 1);
  assert.equal(h.profile().lastSeen, h.oldActivity, 'activity is still waiting');
  h.controlSave({ before: saving });
  const oldSave = h.app.saveState(true);
  await h.idle();
  h.app.state.steps[RESEARCH].answer = NEW;
  const scene = h.input(SCENE, SUBMISSION);
  const review = h.app.submitReview(scene.section, scene.step);
  await h.idle();
  h.doc.emit('wheel');
  h.win.emit('focus');
  assert.equal(h.reviews.length, 0);
  assert.equal(h.app.pendingSaves, 2);
  saving.release();
  await Promise.all([oldSave, review]);
  await h.idle();
  assert.equal(h.reviews.length, 1, 'a slow activity request cannot stall a review');
  assert.match(h.reviews[0].prompt, /NEW RESEARCH/);
  assert.equal(h.saved().steps[SCENE].attempts, 1);
  assert.equal(h.profile().lastSeen, h.oldActivity, 'saves and review are not visits');
  const beforeActivity = h.saved();
  visiting.release();
  await h.idle();
  assert.ok(h.profile().lastSeen > h.oldActivity);
  assert.deepEqual(h.saved(), beforeActivity, 'activity cannot overwrite worksheet state');
  assert.equal(h.requests.filter(r => r.url === '/api/activity').length, 1, 'focus and reading bursts coalesce');
});

test('a failed activity signal does not charge an attempt or poison the save queue', async t => {
  const h = harness(t, { steps: { [RESEARCH]: accepted(NEW) } });
  h.controlActivity({ failure: 401 });
  await h.app.boot();
  await h.idle();
  const scene = h.input(SCENE, SUBMISSION);
  await h.app.submitReview(scene.section, scene.step);
  await h.idle();
  assert.equal(h.reviews.length, 1);
  assert.equal(h.saved().steps[SCENE].attempts, 1);
  assert.equal(h.app.pendingSaves, 0);
  assert.equal(h.profile().lastSeen, h.oldActivity);
});

for (const timing of ['queued save', 'AI review']) {
  test(`instructor approval during ${timing} survives review and activity without duplicate XP`, async t => {
    const key = 'pitch/pitch-outline';
    const h = harness(t, { xp: 100, steps: { [key]: { status: 'pending', answer: 'My five-slide pitch', attempts: 0, thread: [] } } });
    await h.app.boot();
    await h.idle();
    const lastSeen = h.profile().lastSeen;
    const slow = gate();
    if (timing === 'queued save') h.controlSave({ before: slow });
    const ai = h.holdAI();
    const pitch = h.input(key, 'My revised five-slide pitch');
    const review = h.app.submitReview(pitch.section, pitch.step);
    await h.idle();
    if (timing === 'queued save') assert.equal(h.reviews.length, 0);
    else assert.equal(h.reviews.length, 1);
    await h.approve(key);
    // Polling during a review may merge the approval on disk, but must not
    // replace the state object that the verdict handler is still using.
    await h.app.checkApprovals();
    assert.equal(h.app.state.steps[key].status, 'pending');
    h.doc.emit('wheel');
    slow.release();
    await h.idle();
    ai.release();
    await review;
    await h.idle();
    assert.equal(h.reviews.length, 1);
    assert.equal(h.saved().steps[key].status, 'done');
    assert.equal(h.saved().steps[key].verdict.by, 'instructor');
    await h.app.checkApprovals();
    await h.idle();
    const approved = h.app.state.steps[key];
    assert.equal(approved.status, 'done');
    assert.equal(approved.verdict.by, 'instructor');
    assert.equal(approved.attempts, 1);
    assert.equal(approved.thread.filter(m => m.by === 'instructor').length, 1);
    const xp = 100 + pitch.step.xp + pitch.section.xp;
    assert.equal(h.app.state.xp, xp);
    assert.equal(h.app.state.artifacts.pitch, approved.answer);
    await h.app.saveState(true);
    await h.app.checkApprovals();
    await h.idle();
    assert.equal(h.saved().xp, xp);
    assert.equal(h.profile().lastSeen, lastSeen, 'polls, approvals and saves do not extend activity');
    // Acknowledged approvals still allow a later redo to stay pending.
    h.app.state.steps[key].status = 'pending';
    delete h.app.state.steps[key].verdict;
    await h.app.saveState(true);
    assert.equal(h.saved().steps[key].status, 'pending');
  });
}

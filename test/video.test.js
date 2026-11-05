'use strict';

// Exercise the actual gate with controlled YouTube callbacks and a fake clock.
// These model filter failures without depending on YouTube or real-time sleeps.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness({ api = true, constructorFails = false } = {}) {
  let now = 100000, next = 0;
  const timers = new Map(), scripts = [], players = [], blocked = [];
  let completed = 0, playing = 0;
  const YT = {
    PlayerState: { PLAYING: 1, PAUSED: 2, BUFFERING: 3 },
    Player: function (_el, options) {
      if (constructorFails) throw new Error('embed blocked');
      const p = { events: options.events, time: 0, destroyed: false,
        getCurrentTime() { return this.time; }, getPlaybackRate: () => 1,
        seekTo(t) { this.time = t; }, pauseVideo() {}, destroy() { this.destroyed = true; } };
      players.push(p);
      return p;
    },
  };
  const window = api ? { YT } : {};
  const context = vm.createContext({ window, Promise,
    document: {
      createElement: () => ({ remove() { this.removed = true; } }),
      head: { appendChild: tag => scripts.push(tag) },
    },
    Date: { now: () => now },
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = ++next; timers.set(id, { fn, at: now + ms, interval: ms }); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/video.js'), 'utf8'), context);
  return {
    window, YT, players, scripts, blocked,
    create() { return window.VideoGate.create({ el: {}, youtubeId: 'example', start: 0, end: 10,
      onBlocked: reason => blocked.push(reason), onPlaying: () => { playing++; }, onComplete: () => { completed++; } }); },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due; now = timer.at;
        if (timer.interval) timer.at += timer.interval; else timers.delete(id);
        timer.fn();
      }
      now = target;
    },
    get timerCount() { return timers.size; },
    get completed() { return completed; }, get playing() { return playing; },
  };
}

test('video: blocked API script reports once and retries on a later mount', async () => {
  const h = harness({ api: false });
  const first = h.create();
  h.scripts[0].onerror();
  await settle();
  assert.deepEqual(h.blocked, ['api']);
  h.advance(20000);
  assert.deepEqual(h.blocked, ['api']);
  first.destroy();
  h.create();
  assert.equal(h.scripts.length, 2);
  h.window.YT = h.YT;
  h.window.onYouTubeIframeAPIReady();
  await settle();
  assert.equal(h.players.length, 1);
  h.players[0].events.onReady();
  h.advance(20000);
  assert.deepEqual(h.blocked, ['api']);
});

test('video: silently hung API times out and a later mount retries', async () => {
  const h = harness({ api: false });
  h.create();
  h.advance(15000);
  await settle();
  assert.deepEqual(h.blocked, ['timeout']);
  assert.equal(h.scripts[0].removed, true);
  h.create();
  assert.equal(h.scripts.length, 2);
  h.window.YT = h.YT;
  h.window.onYouTubeIframeAPIReady();
  await settle();
  assert.equal(h.players.length, 1, 'the new gate loads after the expired attempt');
  for (const p of h.players) p.events.onReady();
  h.advance(15000);
  assert.deepEqual(h.blocked, ['timeout']);
});

test('video: an embed that never becomes ready reports timeout without completing', async () => {
  const h = harness(); h.create(); await settle();
  h.advance(14999); assert.deepEqual(h.blocked, []);
  h.advance(1); assert.deepEqual(h.blocked, ['timeout']);
  assert.equal(h.completed, 0);
});

test('video: YouTube errors report their code once without completing', async () => {
  const h = harness(); h.create(); await settle();
  const p = h.players[0]; p.events.onReady();
  p.events.onError({ data: 150 }); p.events.onError({ data: 100 });
  h.advance(20000);
  assert.deepEqual(h.blocked, ['error:150']);
  assert.equal(h.completed, 0);
});

test('video: a constructor failure offers a skip instead of an unhandled rejection', async () => {
  const h = harness({ constructorFails: true }); h.create(); await settle();
  assert.deepEqual(h.blocked, ['api']);
});

test('video: sustained buffering reports stalled, including after playback began', async () => {
  const h = harness(); h.create(); await settle();
  const p = h.players[0]; p.events.onReady();
  p.events.onStateChange({ data: 1 });
  p.events.onStateChange({ data: 3 });
  h.advance(10000);
  p.events.onStateChange({ data: 3 }); // repeated buffering does not reset the deadline
  h.advance(4999); assert.deepEqual(h.blocked, []);
  h.advance(1); assert.deepEqual(h.blocked, ['stalled']);
  assert.equal(h.completed, 0);
});

test('video: playing or pausing cancels stall detection and real viewing completes once', async () => {
  const h = harness(); h.create(); await settle();
  const p = h.players[0]; p.events.onReady();
  p.events.onStateChange({ data: 3 }); h.advance(14000);
  p.events.onStateChange({ data: 2 }); h.advance(20000);
  assert.deepEqual(h.blocked, []);
  p.events.onStateChange({ data: 3 }); h.advance(14000);
  p.events.onStateChange({ data: 1 });
  for (let i = 1; i <= 20; i++) { p.time = i / 2; h.advance(500); }
  assert.deepEqual(h.blocked, []);
  assert.equal(h.completed, 1);
  p.events.onStateChange({ data: 1 }); h.advance(20000);
  assert.equal(h.completed, 1);
});

test('video: destroyed gates ignore late events and cancel detection/polling timers', async () => {
  const h = harness(); const gate = h.create(); await settle();
  const p = h.players[0]; p.events.onReady(); p.events.onStateChange({ data: 3 });
  gate.destroy();
  p.events.onReady(); p.events.onError({ data: 150 }); p.events.onStateChange({ data: 1 });
  h.advance(20000);
  assert.equal(p.destroyed, true);
  assert.equal(h.timerCount, 0);
  assert.equal(h.playing, 0);
  assert.equal(h.completed, 0);
  assert.deepEqual(h.blocked, []);
});

test('video: playback recovery rearms detection for a later stall', async () => {
  const h = harness(); h.create(); await settle();
  const p = h.players[0]; p.events.onReady();
  p.events.onStateChange({ data: 3 }); h.advance(15000);
  assert.deepEqual(h.blocked, ['stalled']);
  p.events.onStateChange({ data: 1 });
  p.events.onStateChange({ data: 3 }); h.advance(15000);
  assert.deepEqual(h.blocked, ['stalled', 'stalled']);
  assert.equal(h.completed, 0);
});

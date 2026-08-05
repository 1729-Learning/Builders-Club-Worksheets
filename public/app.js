/* Builders Club — MVP Worksheet demo app: hash router, hub/flow views, real AI review. */
'use strict';

/* ---------------------------------------------------------------- utils */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Escape-first markdown-lite for chat text: **bold**, `code`, and real block
// structure — "- " lines become bullet lists, "1." lines numbered lists, other
// lines short paragraphs — so feedback reads as chunks instead of a wall.
function mdInline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function mdLite(s) {
  const lines = String(s == null ? '' : s).split('\n').map(l => l.trim()).filter(Boolean);
  let html = '', list = [], listTag = '';
  const flush = () => {
    if (list.length) html += `<${listTag}>` + list.map(x => `<li>${x}</li>`).join('') + `</${listTag}>`;
    list = []; listTag = '';
  };
  for (const l of lines) {
    const bullet = l.match(/^[-•]\s+(.*)/);
    const num = l.match(/^\d+[.)]\s+(.*)/);
    const tag = bullet ? 'ul' : num ? 'ol' : '';
    if (tag) {
      if (listTag && listTag !== tag) flush();
      listTag = tag;
      list.push(mdInline((bullet || num)[1]));
    } else {
      flush();
      html += `<p>${mdInline(l)}</p>`;
    }
  }
  flush();
  return html;
}

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
function $(sel, root) { return (root || document).querySelector(sel); }

const AGENT_AVATAR = '<img src="./favicon.svg" alt="AI">';

/* ------------------------------------------------------------- worksheets */
/* WORKSHEETS itself comes from content.js — classic scripts share the global
   scope, so redeclaring it here would be a SyntaxError. */

// Section ids are unique across worksheets, so a section resolves its worksheet.
function wsOfSection(sectionId) {
  return WORKSHEETS.find(w => w.sections.some(s => s.id === sectionId));
}

/* ---------------------------------------------------------------- state */

let state = null;
let saveTimer = null;
let appSettings = { freeRoam: false }; // refreshed from /api/settings at boot and on settings changes

function saveState(immediate) {
  clearTimeout(saveTimer);
  const doSave = () => fetch('/api/state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
  }).catch(() => {});
  if (immediate) return doSave();
  saveTimer = setTimeout(doSave, 500);
}

function keyOf(section, step) { return section.id + '/' + step.id; }
function stepState(k) {
  if (!state.steps[k]) state.steps[k] = { status: 'pending', answer: '', attempts: 0, thread: [] };
  if (!state.steps[k].thread) state.steps[k].thread = [];
  return state.steps[k];
}
function isDone(k) { return state.steps[k] && state.steps[k].status === 'done'; }
function isMastered(k) { return !isDone(k) && !!state.mastery[k]; }

// First step in a section that is neither done nor mastered.
function activeStepIndex(section) {
  for (let i = 0; i < section.steps.length; i++) {
    const k = keyOf(section, section.steps[i]);
    if (!isDone(k) && !isMastered(k)) return i;
  }
  return -1; // all complete
}

function sectionDone(section) {
  const art = section.steps.find(s => s.isArtifact);
  return art ? isDone(keyOf(section, art)) : activeStepIndex(section) === -1;
}

function sectionUnlocked(ws, i) {
  if (appSettings.freeRoam) return true;
  if (ws.sections[i].alwaysUnlocked) return true; // e.g. the Ship It setup walkthrough — needed mid-semester, no content dependency
  return i === 0 || sectionDone(ws.sections[i - 1]);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function awardXP(n) {
  state.xp += n;
  if (state.lastActiveDay !== todayStr()) { state.streak += 1; state.lastActiveDay = todayStr(); }
  updateHeader();
}

// XP is earned once per step — redoing a step never re-awards it.
function awardStepXP(st, n) {
  if (st.xpAwarded) return;
  st.xpAwarded = true;
  awardXP(n);
}

/* ---------------------------------------------------------------- header */

function updateHeader() {
  let done = 0, total = 0;
  for (const w of WORKSHEETS) {
    total += w.sections.length;
    done += w.sections.filter(sectionDone).length;
  }
  $('#secNum').textContent = done;
  $('#secDen').textContent = total;
  $('#xpNum').textContent = state.xp;
  $('#streakNum').textContent = state.streak;
}

/* ---------------------------------------------------------------- router */

let activeGates = []; // live YouTube gates, destroyed on every re-render (free roam can mount several)
let lastRouteHash = null; // navigating to a NEW route always starts at the top of the page

function route() {
  activeGates.forEach(g => g.destroy());
  activeGates = [];
  const h = location.hash || '#/';
  const newRoute = h !== lastRouteHash;
  lastRouteHash = h;
  const startAtTop = () => { if (newRoute) window.scrollTo({ top: 0, behavior: 'instant' }); };

  if (h.startsWith('#/settings')) { renderSettings(); startAtTop(); return; }

  let m = h.match(/^#\/w\/([\w-]+)\/s\/([\w-]+)/);
  if (m) {
    const ws = WORKSHEETS.find(w => w.id === m[1]);
    const section = ws && ws.sections.find(s => s.id === m[2]);
    if (section && sectionUnlocked(ws, ws.sections.indexOf(section))) {
      renderFlow(ws, section);
      startAtTop();
      return;
    }
  }

  // #/w/<id> — everything lives on the home page now; scroll to that worksheet.
  m = h.match(/^#\/w\/([\w-]+)/);
  if (m) {
    const ws = WORKSHEETS.find(w => w.id === m[1]);
    if (ws) {
      renderHome();
      const el = document.getElementById('ws-' + ws.id);
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      return;
    }
  }

  // Legacy pre-multi-worksheet links: #/s/<sectionId>
  m = h.match(/^#\/s\/([\w-]+)/);
  if (m) {
    const ws = wsOfSection(m[1]);
    if (ws) { location.hash = '#/w/' + ws.id + '/s/' + m[1]; return; }
  }

  renderHome();
  startAtTop();
}

/* ---------------------------------------------------------------- hub view */

function stepDotChip(section, step) {
  const k = keyOf(section, step);
  let cls = '', mark = '';
  if (isDone(k)) { cls = 'done'; mark = '✓'; }
  else if (isMastered(k)) { cls = 'mastered'; mark = '★'; }
  else if (section.steps.indexOf(step) === activeStepIndex(section)) cls = 'current';
  return `<span class="stepdot ${cls}" title="${esc(step.title)}">${mark}</span>`;
}

function sectionCardHTML(ws, section, i) {
  const unlocked = sectionUnlocked(ws, i);
  const done = sectionDone(section);
  const artifact = state.artifacts[section.id];
  const stateCls = done ? 'is-done' : unlocked ? 'is-active clickable' : 'is-locked';
  const doneCount = section.steps.filter(st => isDone(keyOf(section, st)) || isMastered(keyOf(section, st))).length;

  return `
  <section class="section ${stateCls}" ${unlocked ? `data-open="${section.id}"` : ''}>
    <div class="sec-head">
      <div class="sec-num">${section.num}</div>
      <div class="sec-headtext">
        <div class="sec-kicker">${esc(section.kicker)}</div>
        <h2 class="sec-title">${esc(section.title)}</h2>
      </div>
      ${section.weeks ? `<span class="wk-chip" title="When this section happens in class">🗓 ${esc(section.weeks)}</span>` : ''}
    </div>
    <p class="sec-tagline">${esc(section.tagline)}</p>
    ${unlocked ? `
      <div class="stepdots">${section.steps.map(st => stepDotChip(section, st)).join('')}
        <span class="req-note" style="margin-left:auto">${doneCount}/${section.steps.length} steps</span>
      </div>
      ${artifact ? `
        <div class="artifact-stamp">
          <div class="alabel">${esc(section.artifactLabel)}</div>
          <div class="atext">${esc(artifact)}</div>
        </div>` : ''}
      <div class="answer-tools">
        <button class="btn ${done ? 'white' : ''}" data-open="${section.id}">${done ? 'Revisit ▸' : doneCount > 0 ? 'Continue ▸' : 'Start ▸'}</button>
      </div>`
    : `<div class="lock-overlay"><span class="lk">🔒</span> Finish “${esc(ws.sections[i - 1].title)}” to unlock.</div>`}
  </section>`;
}

// One big page: every worksheet with all of its section cards.
function renderHome() {
  const view = $('#view');
  view.classList.remove('wide');

  const blocks = WORKSHEETS.map(w => {
    const done = w.sections.filter(sectionDone).length;
    const allDone = done === w.sections.length;
    return `
    <div class="ws-block" id="ws-${w.id}">
      <div class="ws-head">
        <h2 class="ws-title">${esc(w.title)}</h2>
        <p class="ws-sub">${esc(w.subtitle || '')} <span class="ws-count">${done}/${w.sections.length} artifacts</span></p>
      </div>
      ${allDone ? `
      <section class="section is-done finale">
        <div class="trophy">🏆</div>
        <h2 class="sec-title" style="margin-top:8px">${esc(w.title)}: complete.</h2>
        <p class="sec-tagline">All ${w.sections.length} artifacts earned. Download your builder file and bring it to your mentor.</p>
        <div class="answer-tools" style="justify-content:center"><button class="btn green" data-export>Download Builder File ⬇</button></div>
      </section>` : ''}
      ${w.sections.map((s, i) => sectionCardHTML(w, s, i)).join('')}
    </div>`;
  }).join('');

  view.innerHTML = `
    <section class="hero">
      <span class="kicker">BUILDERS CLUB · ONE SEMESTER</span>
      <h1>Your<br>Worksheets</h1>
    </section>
    ${blocks}`;
  updateHeader();
}

/* ---------------------------------------------------------------- settings view */

async function renderSettings() {
  const view = $('#view');
  view.classList.remove('wide');
  view.innerHTML = `
    <div class="flow-topbar"><a class="crumb" href="#/">◂ Worksheets</a></div>
    <section class="hero compact"><span class="kicker">SETTINGS</span><h1>Settings</h1></section>
    <section class="section is-active" id="settings-card"><p class="sec-tagline">Loading…</p></section>`;
  let s = null;
  try { s = await (await fetch('/api/settings', { cache: 'no-store' })).json(); } catch { /* server down */ }
  const card = $('#settings-card');
  if (!card) return; // user navigated away while loading
  if (!s) { card.innerHTML = '<p class="sec-tagline">Couldn’t reach the local server — is it running?</p>'; return; }
  appSettings.freeRoam = !!s.freeRoam;
  card.innerHTML = settingsCardHTML(s);
  card.insertAdjacentHTML('afterend', progressCardHTML(s) + dangerCardHTML());
  updateHeader();
}

function dangerCardHTML() {
  return `
  <section class="section is-active">
    <div class="sec-headtext">
      <div class="sec-kicker">DANGER ZONE</div>
      <h2 class="sec-title">Start completely over</h2>
    </div>
    <p class="sec-tagline">Erases every answer, artifact, review thread, XP point, and streak on this machine — all worksheets back to brand new. There is no undo.</p>
    <div class="answer-tools"><button class="btn danger" data-hardreset>⟲ Hard reset — erase everything</button></div>
  </section>`;
}

function progressCardHTML(s) {
  const free = !!s.freeRoam;
  return `
  <section class="section is-active">
    <div class="sec-headtext">
      <div class="sec-kicker">PROGRESSION</div>
      <h2 class="sec-title">How sections and steps unlock</h2>
    </div>
    <div class="opt-list">
      <button class="opt ${free ? '' : 'sel'}" data-freeroam="off">
        <span class="opt-radio">${free ? '' : '●'}</span>
        <span class="opt-main">
          <span class="opt-title">Guided</span>
          <span class="opt-desc">Sections and steps unlock in order — each one builds on the last. The default classroom experience.</span>
        </span>
      </button>
      <button class="opt ${free ? 'sel' : ''}" data-freeroam="on">
        <span class="opt-radio">${free ? '●' : ''}</span>
        <span class="opt-main">
          <span class="opt-title">Free roam</span>
          <span class="opt-desc">Everything unlocked, any order. Steps that build on skipped work will show an empty "building on" note instead of that work.</span>
        </span>
      </button>
    </div>
  </section>`;
}

function settingsCardHTML(s) {
  const status = e => e.available
    ? `<span class="chip ok">installed ✓</span>`
    : `<span class="chip warn">not installed</span>`;
  const opts = [
    { v: 'auto', title: 'Auto', desc: 'Use Codex when it’s installed (it’s much faster), otherwise Claude Code.', chip: '<span class="chip">recommended</span>' },
    { v: 'codex', title: 'Codex', desc: 'OpenAI’s agent CLI — uses the ChatGPT account signed in on this machine. About 15s per review.', chip: status(s.engines.codex) },
    { v: 'claude', title: 'Claude Code', desc: 'Anthropic’s agent CLI — uses the Claude account signed in on this machine. About 60s per review.', chip: status(s.engines.claude) },
  ];
  const activeName = s.active === 'codex' ? 'Codex' : 'Claude Code';
  return `
    <div class="sec-headtext">
      <div class="sec-kicker">AI REVIEWER</div>
      <h2 class="sec-title">Which engine reviews the work</h2>
    </div>
    <div class="opt-list">
      ${opts.map(o => `
      <button class="opt ${s.reviewBackend === o.v ? 'sel' : ''}" data-backend="${o.v}">
        <span class="opt-radio">${s.reviewBackend === o.v ? '●' : ''}</span>
        <span class="opt-main">
          <span class="opt-title">${o.title}</span>
          <span class="opt-desc">${o.desc}</span>
        </span>
        ${o.chip}
      </button>`).join('')}
    </div>
    <p class="active-note">Reviews are running on: <b>${activeName}</b>${s.activeAvailable ? '' : ' — ⚠ not installed, so reviews will show an offline notice'}</p>`;
}

/* ---------------------------------------------------------------- flow view */

/* Pinned "building on" cards: the earlier work a step consumes, shown above the
   answer box. Combines explicit buildsOn refs with a synthesis step's sources. */
function pinnedSourceKeys(section, step) {
  const keys = [...(step.buildsOn || [])];
  for (const id of (step.synthesizesFrom || [])) {
    const full = section.id + '/' + id;
    if (!keys.includes(full)) keys.push(full);
  }
  return keys;
}

function buildsOnHTML(section, step) {
  const keys = pinnedSourceKeys(section, step);
  if (!keys.length) return '';
  const cards = keys.map(k => {
    const found = findByKey(k);
    if (!found.step) return '';
    let text = ((state.steps[k] || {}).answer || '').trim();
    if (!text && found.step.isArtifact) text = (state.artifacts[found.section.id] || '').trim();
    const label = found.step.isArtifact ? (found.section.artifactLabel || found.step.title) : found.step.title;
    if (!text) {
      return `<div class="buildson empty"><span class="bo-label">Building on · ${esc(label)}</span>
        <div class="bo-note">Nothing here yet — you can still do this step, but it gets stronger once “${esc(found.step.title)}” is done.</div></div>`;
    }
    return `<div class="buildson"><span class="bo-label">Building on · ${esc(label)}</span>
      <div class="bo-text">${esc(text)}</div></div>`;
  }).join('');
  return cards ? `<div class="buildson-wrap">${cards}</div>` : '';
}

// Curated external reading for a step ("Go deeper").
function resourcesHTML(step) {
  if (!step.resources || !step.resources.length) return '';
  return `<div class="resources"><span class="rs-label">📚 Go deeper</span>
    ${step.resources.map(r => `<a class="rs-link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>${r.note ? `<span class="rs-note">— ${esc(r.note)}</span>` : ''}`).join('<br>')}
  </div>`;
}

function lessonHTML(step, k) {
  if (!step.lessonPanel) return '';
  const L = step.lessonPanel;
  return `
    <div class="lesson" id="lesson-${cssId(k)}">
      <h4>The point of this step</h4>
      <p>${L.point}</p>
      <div class="ex good"><span class="tag">Strong</span>${L.good}</div>
      <div class="ex bad"><span class="tag">Too weak</span>${L.bad}</div>
    </div>`;
}

function cssId(k) { return k.replace(/[^\w-]/g, '_'); }

// Explicit user toggles for the history dropdown (key → true = open).
const threadOpen = new Map();

function threadCollapsed(k) {
  return threadOpen.has(k) ? !threadOpen.get(k) : true; // history is collapsed unless the student opens it
}

/* Default review layout: YOUR answer stays in the box, the AI's LATEST response
   sits right underneath, and the full back-and-forth hides behind a dropdown. */
function latestHTML(st, k) {
  const last = [...st.thread].reverse().find(m => m.role === 'agent');
  if (!last) return '';
  return `<div class="review-latest" id="latest-${cssId(k)}">
    <div class="rl-head">${AGENT_AVATAR} Builders AI · latest feedback</div>
    <div class="rl-body">${bubbleHTML(last)}</div>
  </div>`;
}

function historyHTML(st, k) {
  if (st.thread.length < 2) return '';
  const rounds = st.thread.filter(m => m.role === 'user' && m.attempt).length;
  return `<div class="review show ${threadCollapsed(k) ? 'collapsed' : ''}" id="review-${cssId(k)}">
    <div class="review-head" data-collapse="${k}" title="Show / hide the full back-and-forth">
      ${AGENT_AVATAR} Review history${rounds > 1 ? ` · ${rounds} rounds` : ''} <span class="chev">▾</span></div>
    ${st.thread.map(m => bubbleHTML(m)).join('')}
  </div>`;
}

function threadHTML(st, k) {
  return latestHTML(st, k) + historyHTML(st, k);
}

function bubbleHTML(m) {
  if (m.role === 'user') {
    return `<div class="msg user"><div class="msg-avatar">🙂</div>
      <div class="msg-body"><div class="msg-tag">You${m.attempt ? ' · attempt ' + m.attempt : ''}</div><div class="msg-text">${mdLite(m.text)}</div></div></div>`;
  }
  // Rubric "reasons" stay in state (and exports) but aren't rendered — the
  // feedback prose already says it, and a second red list just adds noise.
  return `<div class="msg agent ${m.kind || ''}"><div class="msg-avatar">${AGENT_AVATAR}</div>
    <div class="msg-body"><div class="msg-tag">Builders AI</div><div class="msg-text">${mdLite(m.text)}</div></div></div>`;
}

/* ---- interactive list answer ("add a box" for n-of-things steps) ---- */

const listRows = new Map(); // k -> extra rows the student added beyond what the answer holds

function parseListAnswer(s) {
  const items = String(s || '').split('\n').map(l => l.replace(/^\s*(?:[-•□☐]|\d+[.)])\s*/, ''));
  while (items.length && !items[items.length - 1].trim()) items.pop();
  return items;
}

function listAnswerHTML(step, st, k) {
  const cfg = step.listAnswer;
  const items = parseListAnswer(st.answer);
  // Always start at ONE box — students click + Add to grow toward the required
  // amount (the req-note says how many), instead of facing a wall of empties.
  let n = Math.min(cfg.max, Math.max(1, items.length, listRows.get(k) || 0));
  while (items.length < n) items.push('');
  listRows.set(k, items.length);
  const rows = items.map((t, i) => `
    <div class="li-row">
      <span class="li-num">${i + 1}</span>
      <input type="text" class="li-input" data-list="${k}" data-i="${i}" placeholder="${esc(cfg.placeholder || '')}" value="${esc(t)}">
      ${items.length > 1 ? `<button class="li-del" data-listdel="${k}" data-i="${i}" title="Remove this one">✕</button>` : ''}
    </div>`).join('');
  return `<div class="list-answer" data-listwrap="${k}">
    ${rows}
    ${items.length < cfg.max ? `<button class="ask-btn li-add" data-listadd="${k}">+ Add ${esc((cfg.itemLabel || 'item').toLowerCase())}</button>` : ''}
  </div>`;
}

function serializeList(k) {
  const wrap = document.querySelector(`[data-listwrap="${k}"]`);
  if (!wrap) return;
  const vals = [...wrap.querySelectorAll('.li-input')].map(i => i.value);
  stepState(k).answer = vals.join('\n');
}

/* ---- card-sort boards (two-sided scoreboards + n-column categorize steps) ----

   Two config shapes, one engine:
     board: { left: {...}, right: {...} }         — the classic two-sided scoreboard
     board: { columns: [{id, label, hint, placeholder, min?, max?}, …] } — n columns
   A board WITHOUT a rubric is a keep-adding-forever scoreboard (Save button).
   A board WITH a rubric is a categorize exercise — it goes through Submit & Review. */

function boardCols(step) {
  if (step.board.columns) {
    return step.board.columns.map(c => ({ min: 0, ...c, key: c.id }));
  }
  return [
    { key: 'left', min: step.minPerSide || 1, ...step.board.left },
    { key: 'right', min: step.minPerSide || 1, ...step.board.right },
  ];
}

function ensureBoard(st, cols) {
  if (!st.board) st.board = {};
  for (const c of cols) if (!Array.isArray(st.board[c.key])) st.board[c.key] = [''];
}

function boardAnswerText(step, st) {
  const cols = boardCols(step);
  ensureBoard(st, cols);
  const fmt = key => st.board[key].map(t => t.trim()).filter(Boolean).map(t => '- ' + t).join('\n');
  return cols.map(c => `${c.label.toUpperCase()} (${c.hint}):\n${fmt(c.key) || '- (none yet)'}`).join('\n\n');
}

function serializeBoard(k, step) {
  const st = stepState(k);
  const cols = boardCols(step);
  ensureBoard(st, cols);
  const card = document.getElementById('step-' + cssId(k));
  if (!card) return st;
  for (const c of cols) {
    const vals = [...card.querySelectorAll(`.bd-card[data-side="${c.key}"]`)].map(t => t.value);
    if (vals.length) st.board[c.key] = vals;
  }
  st.answer = boardAnswerText(step, st);
  return st;
}

// The board stays editable forever — done just means "started" (scoreboards)
// or "accepted" (reviewed sorts). Cards keep saving either way.
function boardHTML(section, step, status) {
  const k = keyOf(section, step);
  const id = cssId(k);
  const st = stepState(k);
  const cols = boardCols(step);
  ensureBoard(st, cols);
  const done = status === 'done';
  const reviewed = !!step.rubric;
  const col = (c, ci) => {
    const cards = st.board[c.key].map((t, i) => `
      <div class="bd-cardwrap">
        <textarea class="bd-card" data-board="${k}" data-side="${c.key}" data-i="${i}" placeholder="${esc(c.placeholder || '')}">${esc(t)}</textarea>
        ${st.board[c.key].length > 1 ? `<button class="bd-del" data-boarddel="${k}" data-side="${c.key}" data-i="${i}" title="Remove this card">✕</button>` : ''}
      </div>`).join('');
    const canAdd = !c.max || st.board[c.key].length < c.max;
    return `<div class="board-col" data-bdcol="${c.key}" data-tint="${ci % 3}">
      <div class="bd-head"><span class="bd-label">${esc(c.label)}</span><span class="bd-hint">${esc(c.hint)}</span></div>
      ${cards}
      ${canAdd ? `<button class="ask-btn bd-add" data-boardadd="${k}" data-side="${c.key}">+ Add card</button>` : ''}
    </div>`;
  };
  const doneLabel = reviewed ? (step.isArtifact ? 'Artifact earned ✓' : 'Step complete ✓') : 'Scoreboard live ✓ — keep adding all semester';
  const reqNote = step.boardNote ? `<span class="req-note">${esc(step.boardNote)}</span>`
    : !done ? `<span class="req-note">at least ${step.minPerSide || 1} real moment per side</span>` : '';
  const actions = reviewed
    ? `${step.lessonPanel ? `<button class="ask-btn" data-lesson="${k}">📖 Lesson</button>` : ''}
       <button class="ask-btn" data-askopen="${k}">💬 Ask the assistant</button>
       <button class="btn" data-review="${k}">${st.attempts > 0 ? 'Resubmit ▸' : 'Submit & Review'}</button>
       ${reqNote}`
    : `${step.lessonPanel ? `<button class="ask-btn" data-lesson="${k}">📖 Lesson</button>` : ''}
       <button class="btn" data-saveboard="${k}">${done ? 'Save new cards' : 'Save scoreboard'}</button>
       ${!done ? reqNote : ''}`;
  return `
    ${done && reviewed ? `<button class="redo-btn" data-redostep="${k}" title="Clear this step and do it again">↻ Redo</button>` : ''}
    ${done ? `<div class="done-stamp"><span class="big">${doneLabel}</span><span class="xpgain">+${step.xp} XP</span></div>` : ''}
    ${buildsOnHTML(section, step)}
    ${lessonHTML(step, k)}
    <div class="board cols-${cols.length}">${cols.map(col).join('')}</div>
    <div class="answer-tools">${actions}</div>
    ${reviewed ? `<div class="askbox" id="ask-${id}">
      <input type="text" placeholder="Ask Builders AI a question about this step…" id="askin-${id}">
      <button class="ask-btn" data-asksend="${k}">Send</button>
    </div>` : ''}
    ${reviewed ? threadHTML(st, k) : ''}`;
}

function stepBodyHTML(section, step, status) {
  const k = keyOf(section, step);
  const st = stepState(k);
  const id = cssId(k);

  if (status === 'locked') {
    return `<div class="lock-overlay"><span class="lk">🔒</span> Complete the previous step to unlock.</div>`;
  }

  if (status === 'mastered') {
    return `
      <div class="mastered-badge">
        <span class="mb-big">MASTERED — SKIP ★</span>
        <span class="mb-why">${esc(state.mastery[k].reason || 'Your earlier work already shows this skill.')}</span>
        <button class="ask-btn" data-unmaster="${k}">Do it anyway</button>
      </div>`;
  }

  // Walkthrough checklists (trusted HTML from content.js — links, <code>, <em>).
  const guide = step.guide ? `<ol class="guide">${step.guide.map(g => `<li>${g}</li>`).join('')}</ol>` : '';

  if (step.board) return boardHTML(section, step, status); // scoreboards AND reviewed card-sorts

  if (status === 'done') {
    const redoBtn = `<button class="redo-btn" data-redostep="${k}" title="Clear this step and do it again">↻ Redo</button>`;
    if (step.type === 'video') {
      return `${redoBtn}
        <div class="done-stamp"><span class="big">Segment complete ✓</span><span class="xpgain">+${step.xp} XP</span></div>
        ${step.videoRecap ? `<div class="recap"><h4>What that segment gave you</h4><ul>${step.videoRecap.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}`;
    }
    return `${redoBtn}
      ${guide}
      <div class="prev-answer"><span class="pa-label">Your accepted answer</span>${esc(st.answer)}</div>
      ${threadHTML(st, k)}
      <div class="done-stamp"><span class="big">${step.isArtifact ? 'Artifact earned ✓' : 'Step complete ✓'}</span><span class="xpgain">+${step.xp}${step.isArtifact ? ' +' + section.xp : ''} XP</span></div>`;
  }

  /* ---- active ---- */
  if (step.type === 'video') {
    const v = step.video;
    return `
      <div class="video-frame"><div id="yt-${id}"></div></div>
      <div class="video-meta">
        <div class="video-progress"><div class="vp-fill" id="vpfill-${id}"></div></div>
        <span class="video-readout" id="vpread-${id}">segment ${fmtClock(v.start)}–${fmtClock(v.end)}</span>
      </div>
      ${resourcesHTML(step)}`;
  }

  const isJournal = step.type === 'journal';
  const cfg = step.listAnswer;
  const reqNote = cfg ? `<span class="req-note">${cfg.min}–${cfg.max} ${esc((cfg.itemLabel || 'item').toLowerCase())}s</span>`
    : isJournal && step.minLines ? `<span class="req-note">at least ${step.minLines} lines</span>` : '';
  const fieldLabel = cfg ? `Your ${esc((cfg.itemLabel || 'item').toLowerCase())}s` : 'Your answer';

  const answerField = cfg
    ? listAnswerHTML(step, st, k)
    : `<textarea class="answer" id="ta-${id}" data-draft="${k}" placeholder="${esc(step.placeholder || 'Write your answer here…')}">${esc(st.answer || '')}</textarea>`;

  return `
    ${buildsOnHTML(section, step)}
    ${guide}
    ${lessonHTML(step, k)}
    <div class="answer-wrap">
      ${step.practice ? `<div class="practice-cta">
        <button class="btn" data-copypractice="${k}">🎙 Copy the practice-interview setup</button>
        <span class="pc-note">paste it into your own AI chat — it takes it from there</span>
      </div>` : ''}
      <label class="field-label" for="ta-${id}">${fieldLabel}</label>
      ${answerField}
      <div class="answer-tools">
        ${step.lessonPanel ? `<button class="ask-btn" data-lesson="${k}">📖 Lesson</button>` : ''}
        ${!isJournal ? `<button class="ask-btn" data-askopen="${k}">💬 Ask the assistant</button>` : ''}
        ${!isJournal ? `<button class="ask-btn" data-copyprompt="${k}" title="Copy this whole step — task, checklist, and your work so far — as a prompt you can paste into any AI chat">📋 Copy for another AI</button>` : ''}
        ${isJournal
          ? `<button class="btn" data-savejournal="${k}">Save entry</button>`
          : `<button class="btn" data-review="${k}">${st.attempts > 0 ? 'Resubmit ▸' : 'Submit & Review'}</button>`}
        ${reqNote}
      </div>
      <div class="askbox" id="ask-${id}">
        <input type="text" placeholder="Ask Builders AI a question about this step…" id="askin-${id}">
        <button class="ask-btn" data-asksend="${k}">Send</button>
      </div>
    </div>
    ${resourcesHTML(step)}
    ${threadHTML(st, k)}`;
}

/* Two flow layouts: focus mode shows ONE step at a time (near full-screen);
   scroll mode stacks every step on one page. The choice sticks per device.
   focusView remembers which step each section is looking at. */
let focusMode = localStorage.getItem('bc.focus') !== '0';
const focusView = new Map(); // sectionId -> step index

function modeBtnHTML() {
  return `<button class="mode-btn" data-mode title="${focusMode ? 'See every step on one page' : 'One step at a time, big'}">
    ${focusMode ? '☰ Scroll view' : '▣ Focus view'}</button>`;
}

function stepViewable(section, i) {
  if (appSettings.freeRoam) return true;
  const a = activeStepIndex(section);
  if (a === -1) return true;
  const k = keyOf(section, section.steps[i]);
  return i <= a || isDone(k) || isMastered(k);
}

function focusIndex(section) {
  const a = activeStepIndex(section);
  let idx = focusView.has(section.id) ? focusView.get(section.id) : (a === -1 ? section.steps.length - 1 : a);
  idx = Math.max(0, Math.min(idx, section.steps.length - 1));
  if (!stepViewable(section, idx)) idx = a;
  return idx;
}

// After completing a step, move on to the next thing to do.
function advanceFocus(section) {
  const a = activeStepIndex(section);
  if (a >= 0) focusView.set(section.id, a); else focusView.delete(section.id);
  route();
  if (focusMode) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (a >= 0) {
    const card = document.getElementById('step-' + cssId(keyOf(section, section.steps[a])));
    if (card) setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  }
}

function sectionRedoBtn(section) {
  const hasProgress = section.steps.some(st => isDone(keyOf(section, st)) || isMastered(keyOf(section, st)) || (state.steps[keyOf(section, st)] || {}).answer);
  return hasProgress ? `<button class="redo-btn" style="position:static" data-redo="${section.id}" title="Clear this section and start it over">↻ Redo section</button>` : '';
}

function renderFlow(ws, section) {
  $('#view').classList.toggle('wide', focusMode);
  if (focusMode) renderFocus(ws, section); else renderScroll(ws, section);
}

/* Focus mode: rail on top, one big step card, prev/next. */
function renderFocus(ws, section) {
  const view = $('#view');
  const activeIdx = activeStepIndex(section);
  const idx = focusIndex(section);
  const step = section.steps[idx];
  const k = keyOf(section, step);

  let status;
  if (isDone(k)) status = 'done';
  else if (isMastered(k)) status = 'mastered';
  else if (idx === activeIdx || appSettings.freeRoam) status = 'active';
  else status = 'locked';
  const cls = { done: 'is-done', mastered: 'is-mastered', active: 'is-active', locked: 'is-locked' }[status];

  const rail = section.steps.map((s, i) => {
    const kk = keyOf(section, s);
    let c = '', mark = String(i + 1);
    if (isDone(kk)) { c = 'done'; mark = '✓'; }
    else if (isMastered(kk)) { c = 'mastered'; mark = '★'; }
    else if (i === activeIdx) c = 'current';
    const canGo = stepViewable(section, i);
    if (i === idx) c += ' viewing';
    return `<button class="railstep ${c}" ${canGo ? `data-focus="${section.id}/${i}"` : 'disabled'} title="${esc(s.title)}">${mark}</button>`;
  }).join('<span class="railtick"></span>');

  const nextLocked = idx === section.steps.length - 1 || !stepViewable(section, idx + 1);

  view.innerHTML = `
    <div class="flow-topbar">
      <a class="crumb" href="#/w/${ws.id}">◂ ${esc(ws.title)}</a>
      <div class="steprail">${rail}</div>
      <div class="flow-actions">${section.weeks ? `<span class="wk-chip">🗓 ${esc(section.weeks)}</span>` : ''}${modeBtnHTML()}${sectionRedoBtn(section)}</div>
    </div>
    <section class="section focus ${cls}" id="step-${cssId(k)}">
      <div class="sec-head">
        <div class="sec-num">${idx + 1}</div>
        <div class="sec-headtext">
          <div class="sec-kicker">${esc(section.kicker)} · ${esc(section.title)}</div>
          <h2 class="sec-title">${esc(step.title)}</h2>
        </div>
      </div>
      ${status !== 'locked' ? `<p class="sec-prompt">${esc(step.prompt)}</p>` : ''}
      ${stepBodyHTML(section, step, status)}
    </section>
    <div class="focus-nav">
      <button class="ask-btn" data-focus="${section.id}/${idx - 1}" ${idx === 0 ? 'disabled' : ''}>◂ Previous</button>
      <span class="req-note">STEP ${idx + 1} OF ${section.steps.length} · ${step.type.toUpperCase()}</span>
      <button class="ask-btn" data-focus="${section.id}/${idx + 1}" ${nextLocked ? 'disabled' : ''}>Next ▸</button>
    </div>`;

  if (status === 'active' && step.type === 'video') mountVideo(section, step);
  maybeAutoDraft(section);
  updateHeader();
}

/* Scroll mode: every step stacked on one page. */
function renderScroll(ws, section) {
  const view = $('#view');
  const activeIdx = activeStepIndex(section);

  const steps = section.steps.map((step, i) => {
    const k = keyOf(section, step);
    let status;
    if (isDone(k)) status = 'done';
    else if (isMastered(k)) status = 'mastered';
    else if (i === activeIdx || appSettings.freeRoam) status = 'active';
    else status = i < activeIdx || activeIdx === -1 ? 'done' : 'locked';
    const cls = { done: 'is-done', mastered: 'is-mastered', active: 'is-active', locked: 'is-locked' }[status];

    return `
    <section class="section ${cls}" id="step-${cssId(k)}">
      <div class="sec-head">
        <div class="sec-num">${i + 1}</div>
        <div class="sec-headtext">
          <div class="sec-kicker">STEP ${i + 1} OF ${section.steps.length} · ${step.type.toUpperCase()}</div>
          <h2 class="sec-title">${esc(step.title)}</h2>
        </div>
      </div>
      ${status !== 'locked' ? `<p class="sec-prompt">${esc(step.prompt)}</p>` : ''}
      ${stepBodyHTML(section, step, status)}
    </section>`;
  }).join('');

  view.innerHTML = `
    <div class="flow-topbar">
      <a class="crumb" href="#/w/${ws.id}">◂ ${esc(ws.title)}</a>
      <div class="flow-actions">${section.weeks ? `<span class="wk-chip">🗓 ${esc(section.weeks)}</span>` : ''}${modeBtnHTML()}${sectionRedoBtn(section)}</div>
    </div>
    <section class="hero compact">
      <h1>${esc(section.kicker)}</h1>
    </section>
    ${steps}`;

  // Mount every video rendered as active (free roam can have several at once).
  section.steps.forEach((step, i) => {
    if (step.type !== 'video') return;
    const k = keyOf(section, step);
    if (isDone(k) || isMastered(k)) return;
    if (i === activeIdx || appSettings.freeRoam) mountVideo(section, step);
  });
  maybeAutoDraft(section);
  updateHeader();
}

/* ---------------------------------------------------------------- video wiring */

function mountVideo(section, step) {
  const k = keyOf(section, step);
  const st = stepState(k);
  const id = cssId(k);
  const host = document.getElementById('yt-' + id);
  if (!host) return;
  const span = step.video.end - step.video.start;

  activeGates.push(VideoGate.create({
    el: host,
    youtubeId: step.video.youtubeId,
    start: step.video.start,
    end: step.video.end,
    resumeAt: st.maxWatched || step.video.start,
    watchedSeconds: st.watchedSeconds || 0,
    onProgress({ maxWatched, watchedSeconds, pct }) {
      st.maxWatched = maxWatched;
      st.watchedSeconds = watchedSeconds;
      const fill = document.getElementById('vpfill-' + id);
      const read = document.getElementById('vpread-' + id);
      if (fill) fill.style.width = (pct * 100).toFixed(1) + '%';
      if (read) read.textContent = fmtClock(Math.max(0, maxWatched - step.video.start)) + ' / ' + fmtClock(span);
      saveState();
    },
    onComplete() { completeVideo(section, step); },
  }));
}

function completeVideo(section, step) {
  const k = keyOf(section, step);
  const st = stepState(k);
  if (st.status === 'done') return;
  st.status = 'done';
  awardStepXP(st, step.xp || 20);
  saveState(true);
  setTimeout(() => advanceFocus(section), 600);
}

/* ---------------------------------------------------------------- journal steps */

function saveJournal(section, step) {
  const k = keyOf(section, step);
  const st = stepState(k);

  if (step.listAnswer) {
    serializeList(k); // writes the current boxes into st.answer, pass or fail
    const items = parseListAnswer(st.answer).map(t => t.trim()).filter(Boolean);
    if (items.length < step.listAnswer.min) {
      const wrap = document.querySelector(`[data-listwrap="${k}"]`);
      if (wrap) { wrap.classList.add('shake'); setTimeout(() => wrap.classList.remove('shake'), 420); }
      saveState(true); // too few to accept, but never lose what they've typed
      return;
    }
    st.answer = items.join('\n');
  } else {
    const ta = document.getElementById('ta-' + cssId(k));
    const val = ta.value.trim();
    const lines = val.split('\n').map(l => l.trim()).filter(Boolean);
    if ((step.minLines && lines.length < step.minLines) || (step.minLength && val.length < step.minLength)) {
      ta.classList.add('shake');
      setTimeout(() => ta.classList.remove('shake'), 420);
      ta.focus();
      st.answer = ta.value; saveState(true); // too short to accept, but never lose what they've written
      return;
    }
    st.answer = val;
  }
  st.status = 'done';
  let gained = step.xp || 15;
  if (step.isArtifact) { // walkthrough artifacts (e.g. the live link) are journal steps
    state.artifacts[section.id] = st.answer;
    gained += section.xp || 0;
  }
  awardStepXP(st, gained);
  saveState(true);
  if (step.isArtifact) {
    const ws = wsOfSection(section.id);
    location.hash = ws ? '#/w/' + ws.id : '#/';
  } else advanceFocus(section);
}

// Validate every column against its minimum. Shakes the first offender and
// returns false — after an immediate save, so a failed check never loses cards.
function boardMeetsMinimums(k, step, st) {
  const cols = boardCols(step);
  const count = key => st.board[key].filter(t => t.trim()).length;
  for (const c of cols) {
    if (count(c.key) < c.min) {
      const col = document.querySelector(`#step-${cssId(k)} [data-bdcol="${c.key}"]`);
      if (col) { col.classList.add('shake'); setTimeout(() => col.classList.remove('shake'), 420); }
      saveState(true); // too few cards to accept, but serializeBoard already captured them
      return false;
    }
  }
  if (step.minTotal && cols.reduce((n, c) => n + count(c.key), 0) < step.minTotal) {
    const board = document.querySelector(`#step-${cssId(k)} .board`);
    if (board) { board.classList.add('shake'); setTimeout(() => board.classList.remove('shake'), 420); }
    saveState(true);
    return false;
  }
  return true;
}

function saveBoard(section, step) {
  const k = keyOf(section, step);
  const st = serializeBoard(k, step);
  const wasDone = st.status === 'done';

  if (!boardMeetsMinimums(k, step, st)) return;
  st.status = 'done';
  awardStepXP(st, step.xp || 15);
  saveState(true);
  if (wasDone) {
    const btn = document.querySelector(`[data-saveboard="${k}"]`);
    if (btn) { const old = btn.textContent; btn.textContent = '✓ Saved'; setTimeout(() => { btn.textContent = old; }, 1400); }
  } else advanceFocus(section);
}

/* ---------------------------------------------------------------- AI review */

/* The live feedback area: one box under the answer showing the AI's LATEST
   response (spinner while it thinks). History accumulates in st.thread and
   shows up in the collapsed dropdown on the next render. */
function setLatest(k, html) {
  const card = document.getElementById('step-' + cssId(k));
  if (!card) return null;
  let box = card.querySelector('.review-latest');
  if (!box) {
    box = el(`<div class="review-latest" id="latest-${cssId(k)}">
      <div class="rl-head">${AGENT_AVATAR} Builders AI · latest feedback</div>
      <div class="rl-body"></div></div>`);
    const hist = card.querySelector('.review');
    if (hist) card.insertBefore(box, hist); else card.appendChild(box);
  }
  box.querySelector('.rl-body').innerHTML = html;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return box;
}

function spinnerHTML(label) {
  return `<div class="msg agent"><div class="msg-avatar">${AGENT_AVATAR}</div>
    <div class="msg-body"><div class="thinking-row"><span class="spinner"></span> ${label}</div></div></div>`;
}

// Keep the collapsed history dropdown in sync without re-rendering the step.
function refreshHistory(k) {
  const card = document.getElementById('step-' + cssId(k));
  if (!card) return;
  const html = historyHTML(stepState(k), k);
  const existing = card.querySelector('.review');
  if (existing) existing.outerHTML = html;
  else if (html) {
    const latest = card.querySelector('.review-latest');
    if (latest) latest.insertAdjacentHTML('afterend', html);
    else card.insertAdjacentHTML('beforeend', html);
  }
}

// Disable/enable the answer inputs (textarea or list rows) while a review runs.
function setAnswerBusy(k, busy) {
  const ta = document.getElementById('ta-' + cssId(k));
  if (ta) { ta.disabled = busy; ta.classList.toggle('dimmed', busy); }
  const wrap = document.querySelector(`[data-listwrap="${k}"]`);
  if (wrap) {
    wrap.classList.toggle('dimmed', busy);
    wrap.querySelectorAll('input,button').forEach(n => { n.disabled = busy; });
  }
  const board = document.querySelector(`#step-${cssId(k)} .board`);
  if (board) {
    board.classList.toggle('dimmed', busy);
    board.querySelectorAll('textarea,button').forEach(n => { n.disabled = busy; });
  }
}

async function submitReview(section, step) {
  const k = keyOf(section, step);
  const st = stepState(k);
  const id = cssId(k);
  const ta = document.getElementById('ta-' + id);
  const btn = document.querySelector(`[data-review="${k}"]`);

  let val;
  if (step.board) {
    serializeBoard(k, step); // captures every card into st.board + st.answer, pass or fail
    if (!boardMeetsMinimums(k, step, st)) return;
    val = boardAnswerText(step, st);
  } else if (step.listAnswer) {
    serializeList(k); // writes the current boxes into st.answer, pass or fail
    const items = parseListAnswer(st.answer).map(t => t.trim()).filter(Boolean);
    if (items.length < step.listAnswer.min) {
      const wrap = document.querySelector(`[data-listwrap="${k}"]`);
      if (wrap) { wrap.classList.add('shake'); setTimeout(() => wrap.classList.remove('shake'), 420); }
      saveState(true); // too few to submit, but never lose what they've typed
      return;
    }
    val = items.map((t, i) => `${i + 1}. ${t}`).join('\n');
  } else {
    val = ta.value.trim();
    if (val.length < 3) {
      ta.classList.add('shake'); setTimeout(() => ta.classList.remove('shake'), 420); ta.focus();
      st.answer = ta.value; saveState(true); // too short to submit, but never lose what they've typed
      return;
    }
  }

  st.answer = step.board ? val
    : step.listAnswer ? parseListAnswer(st.answer).map(t => t.trim()).filter(Boolean).join('\n')
    : val;
  st.attempts += 1;
  setAnswerBusy(k, true);
  btn.disabled = true;

  // Every submitted version lives in the history, so revisions stay reviewable.
  st.thread.push({ role: 'user', text: val, attempt: st.attempts });
  setLatest(k, spinnerHTML(st.attempts === 1 ? 'Reviewing your answer… this can take a minute.' : 'Re-checking your revision… this can take a minute.'));
  saveState();

  let verdict;
  try {
    const res = await fetch('/api/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionId: section.id, stepId: step.id, answer: val, attempt: st.attempts, lastFeedback: st.lastFeedback || '' }),
    });
    verdict = await res.json();
  } catch {
    verdict = { pass: false, offline: true, feedback: 'Couldn’t reach the local server — is `node server.js` still running?', reasons: [], hint: '', masteryFlags: [] };
  }

  if (verdict.offline) {
    st.attempts -= 1; // an offline round shouldn't count against them
    const m = { role: 'agent', kind: 'offline', text: verdict.feedback };
    st.thread.push(m); setLatest(k, bubbleHTML(m));
    refreshHistory(k);
    setAnswerBusy(k, false); btn.disabled = false;
    saveState();
    return;
  }

  st.verdict = { pass: verdict.pass, ts: Date.now() };
  st.lastFeedback = verdict.feedback;

  if (verdict.pass) {
    const m = { role: 'agent', kind: 'good', text: '**Requirements met ✓**\n' + verdict.feedback, reasons: verdict.reasons };
    st.thread.push(m); setLatest(k, bubbleHTML(m));
    st.status = 'done';
    let gained = step.xp || 30;
    if (step.isArtifact) {
      state.artifacts[section.id] = st.answer;
      gained += section.xp || 0;
    }
    applyMasteryFlags(verdict.masteryFlags, step);
    awardStepXP(st, gained);
    saveState(true);
    setTimeout(() => {
      if (step.isArtifact) {
        const ws = wsOfSection(section.id);
        location.hash = ws ? '#/w/' + ws.id : '#/';
      } else advanceFocus(section);
    }, 1600);
  } else {
    // One bubble per round: feedback + hint together, no separate red checklist.
    const m1 = { role: 'agent', text: verdict.feedback + (verdict.hint ? '\n\n💡 **Hint** — ' + verdict.hint : ''), reasons: verdict.reasons };
    st.thread.push(m1); setLatest(k, bubbleHTML(m1));
    refreshHistory(k);
    setAnswerBusy(k, false);
    btn.disabled = false; btn.textContent = 'Resubmit ▸';
    if (ta) ta.focus();
    saveState(true); // rejected — never advance, but the attempt + feedback thread are never lost
  }
}

function applyMasteryFlags(flags, sourceStep) {
  (flags || []).forEach(fk => {
    if (isDone(fk) || state.mastery[fk]) return;
    state.mastery[fk] = { reason: `Builders AI saw this skill in your “${sourceStep.title}” work.`, ts: Date.now() };
  });
}

/* ---------------------------------------------------------------- assistant chat + draft */

async function askAssistant(section, step) {
  const k = keyOf(section, step);
  const st = stepState(k);
  const id = cssId(k);
  const input = document.getElementById('askin-' + id);
  const q = input.value.trim();
  if (!q) { input.focus(); return; }
  input.value = '';

  st.thread.push({ role: 'user', text: q });
  const qBubble = bubbleHTML({ role: 'user', text: q });
  setLatest(k, qBubble + spinnerHTML('Thinking…'));
  saveState();

  let reply = '';
  try {
    const res = await fetch('/api/assist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionId: section.id, stepId: step.id, kind: 'chat', message: q }),
    });
    const data = await res.json();
    reply = data.offline ? 'The assistant is offline right now — check that Claude Code is logged in.' : data.text;
  } catch {
    reply = 'Couldn’t reach the local server — is `node server.js` still running?';
  }
  const m = { role: 'agent', text: reply };
  st.thread.push(m); setLatest(k, qBubble + bubbleHTML(m));
  refreshHistory(k);
  saveState();
}

async function draftFromWork(section, step) {
  const k = keyOf(section, step);
  const st = stepState(k);
  const ta = document.getElementById('ta-' + cssId(k));

  setAnswerBusy(k, true);
  if (ta && !ta.value.trim()) ta.placeholder = '✍️ Assembling a first draft from your own work — a few seconds…';

  let text = '';
  try {
    const res = await fetch('/api/assist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionId: section.id, stepId: step.id, kind: 'draft' }),
    });
    text = (await res.json()).text || '';
  } catch { /* server down */ }

  setAnswerBusy(k, false);

  if (!text) {
    // Offline: leave st.autoDrafted unset so the next visit retries automatically.
    if (ta) ta.placeholder = step.placeholder || 'Write your answer here…';
    return;
  }

  st.autoDrafted = true; // success — never auto-overwrite their edits after this
  st.answer = step.listAnswer ? parseListAnswer(text).map(t => t.trim()).filter(Boolean).join('\n') : text;
  saveState();
  if (step.listAnswer) { listRows.delete(k); route(); }
  else if (ta) { ta.value = st.answer; ta.focus(); }
}

/* Synthesis steps auto-draft on first open: the student edits a draft built
   from their own words instead of staring at a blank box, and the review then
   tells them what to change. Persists st.autoDrafted only on success, so an
   offline attempt retries next visit; autoDraftTried stops same-session loops. */
const autoDraftTried = new Set();

function maybeAutoDraft(section) {
  for (const step of section.steps) {
    if (step.type !== 'synthesis') continue;
    const k = keyOf(section, step);
    const st = stepState(k);
    if (st.status === 'done' || st.autoDrafted || autoDraftTried.has(k) || (st.answer || '').trim()) continue;
    const card = document.getElementById('step-' + cssId(k));
    if (!card || !card.classList.contains('is-active')) continue;
    const hasSource = (step.synthesizesFrom || []).some(id => ((state.steps[section.id + '/' + id] || {}).answer || '').trim());
    if (!hasSource) continue;
    autoDraftTried.add(k);
    draftFromWork(section, step);
    return; // one auto-draft at a time — the queue serializes AI calls anyway
  }
}

/* ---------------------------------------------------------------- portable prompt */

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* blocked — try legacy path */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand('copy')) throw new Error('copy blocked');
  } finally { ta.remove(); }
}

// Managed school devices sometimes block the clipboard outright — worst case,
// show the prompt preselected so the student can copy it by hand.
function showCopyFallback(k, text) {
  const card = document.getElementById('step-' + cssId(k));
  if (!card) return;
  let box = card.querySelector('.copy-fallback');
  if (!box) {
    box = el(`<div class="copy-fallback">
      <div class="cf-note">Clipboard is blocked on this device — the prompt is selected below. Copy it (Ctrl/⌘-C), then paste into any AI chat. <a data-cfclose>dismiss</a></div>
      <textarea readonly></textarea></div>`);
    card.appendChild(box);
  }
  const ta = box.querySelector('textarea');
  ta.value = text;
  ta.focus();
  ta.select();
}

// Copy a self-contained prompt so the student can work in any AI chat:
// kind 'review' = get feedback when the local reviewer is down;
// kind 'practice' = the role-played practice interview.
async function copyPortablePrompt(btn, kind) {
  const k = btn.dataset.copyprompt || btn.dataset.copypractice;
  const { section, step } = findByKey(k);
  if (!section || !step) return;
  const st = stepState(k);
  const ta = document.getElementById('ta-' + cssId(k));
  const old = btn.textContent;
  btn.disabled = true;
  const restore = () => setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 2600);

  let prompt;
  try {
    const res = await fetch('/api/prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectionId: section.id, stepId: step.id, kind: kind || 'review',
        answer: ta ? ta.value.trim() : (st.answer || ''),
        attempt: st.attempts + 1, lastFeedback: st.lastFeedback || '',
      }),
    });
    prompt = (await res.json()).prompt;
  } catch {
    btn.textContent = '✗ Couldn’t reach the local server';
    restore();
    return;
  }

  try {
    await copyText(prompt);
    btn.textContent = kind === 'practice' ? '✓ Copied — paste it into your AI chat and start asking' : '✓ Copied — paste it into any AI chat';
  } catch {
    showCopyFallback(k, prompt);
    btn.textContent = 'Select & copy it below ↓';
  }
  restore();
}

/* ---------------------------------------------------------------- redo a section */

function redoSection(sectionId) {
  const ws = wsOfSection(sectionId);
  const section = ws && ws.sections.find(s => s.id === sectionId);
  if (!section) return;
  const idx = ws.sections.indexOf(section);
  const laterProgress = ws.sections.slice(idx + 1).some(s2 => s2.steps.some(st => isDone(keyOf(s2, st))));
  const warn = laterProgress ? ' Later sections keep their work but re-lock until this one is finished again.' : '';
  if (!confirm(`Redo “${section.title}”? This clears all its steps and its artifact.${warn}`)) return;

  for (const step of section.steps) {
    const k = keyOf(section, step);
    const hadXP = state.steps[k] && state.steps[k].xpAwarded;
    delete state.steps[k];
    if (hadXP) state.steps[k] = { status: 'pending', answer: '', attempts: 0, thread: [], xpAwarded: true };
    delete state.mastery[k];
  }
  delete state.artifacts[section.id];
  focusView.delete(section.id);
  saveState(true);
  location.hash = '#/w/' + ws.id + '/s/' + section.id;
  route();
}

function redoStep(k) {
  const { section, step } = findByKey(k);
  if (!section || !step) return;
  const warn = step.isArtifact ? ' This removes the section’s artifact, and later sections re-lock until it’s earned again.' : '';
  if (!confirm(`Redo “${step.title}”? Your last answer stays in the box, but the step has to be completed again.${warn}`)) return;

  const st = stepState(k);
  st.status = 'pending';
  st.attempts = 0;
  st.thread = [];
  delete st.verdict;
  delete st.lastFeedback;
  if (step.type === 'video') { delete st.maxWatched; delete st.watchedSeconds; st.answer = ''; }
  if (step.isArtifact) delete state.artifacts[section.id];
  focusView.set(section.id, section.steps.indexOf(step));
  saveState(true);
  route();
  if (!focusMode) {
    const card = document.getElementById('step-' + cssId(k));
    if (card) setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  }
}

/* ---------------------------------------------------------------- builder file export */

function exportBuilderFile() {
  const lines = ['# Builders Club — Builder File', '', `_Exported ${new Date().toLocaleString()} · ${state.xp} XP · ${state.streak}-day streak_`, ''];
  for (const ws of WORKSHEETS) {
    const touched = ws.sections.some(s => s.steps.some(st => {
      const k = keyOf(s, st);
      return isDone(k) || isMastered(k);
    }));
    if (!touched) continue;
    lines.push(`# ${ws.title}`, '');
    for (const section of ws.sections) {
    lines.push(`## ${section.num}. ${section.title}`);
    const artifact = state.artifacts[section.id];
    if (artifact) lines.push('', `> **${section.artifactLabel}**`, '>', ...artifact.split('\n').map(l => '> ' + l), '');
    for (const step of section.steps) {
      const k = keyOf(section, step);
      const st = state.steps[k];
      if (isMastered(k)) { lines.push(`### ${step.title}`, '', `_Mastered — skipped. ${state.mastery[k].reason}_`, ''); continue; }
      if (!st || st.status !== 'done') continue;
      lines.push(`### ${step.title}`, '');
      if (step.type === 'video') {
        lines.push(`_Watched segment ${fmtClock(step.video.start)}–${fmtClock(step.video.end)} of youtube.com/watch?v=${step.video.youtubeId}_`, '');
        continue;
      }
      lines.push(`**Task:** ${step.prompt}`, '', st.answer || '', '');
      if (st.verdict && st.verdict.pass) lines.push(`_Accepted by Builders AI after ${st.attempts} attempt${st.attempts === 1 ? '' : 's'}._`, '');
    }
    lines.push('');
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'my-builder-file.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------------------------------------------------------- wiring */

function findByKey(k) {
  const [sid, stid] = k.split('/');
  const ws = wsOfSection(sid);
  const section = ws && ws.sections.find(s => s.id === sid);
  const step = section && section.steps.find(s => s.id === stid);
  return { ws, section, step };
}

function wire() {
  document.addEventListener('click', e => {
    const coll = e.target.closest('[data-collapse]');
    if (coll) {
      const k = coll.dataset.collapse;
      const thread = document.getElementById('review-' + cssId(k));
      if (thread) {
        thread.classList.toggle('collapsed');
        threadOpen.set(k, !thread.classList.contains('collapsed'));
      }
      return;
    }

    const redoS = e.target.closest('[data-redostep]');
    if (redoS) { redoStep(redoS.dataset.redostep); return; }

    const redo = e.target.closest('[data-redo]');
    if (redo) { redoSection(redo.dataset.redo); return; }

    const foc = e.target.closest('[data-focus]');
    if (foc && !foc.disabled) {
      const [sid, i] = foc.dataset.focus.split('/');
      focusView.set(sid, parseInt(i, 10));
      route();
      return;
    }

    const fr = e.target.closest('[data-freeroam]');
    if (fr) {
      const y = window.scrollY; // re-render resets scroll — put the user back where they were
      fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ freeRoam: fr.dataset.freeroam === 'on' }),
      }).then(r => r.json())
        .then(s => { appSettings.freeRoam = !!s.freeRoam; return renderSettings(); })
        .then(() => window.scrollTo({ top: y, behavior: 'instant' }))
        .catch(() => {});
      return;
    }

    const be = e.target.closest('[data-backend]');
    if (be) {
      const y = window.scrollY;
      fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewBackend: be.dataset.backend }),
      }).then(() => renderSettings())
        .then(() => window.scrollTo({ top: y, behavior: 'instant' }))
        .catch(() => {});
      return;
    }

    const mode = e.target.closest('[data-mode]');
    if (mode) {
      focusMode = !focusMode;
      try { localStorage.setItem('bc.focus', focusMode ? '1' : '0'); } catch {}
      route();
      return;
    }

    const open = e.target.closest('[data-open]');
    if (open) {
      const ws = wsOfSection(open.dataset.open);
      if (ws) location.hash = '#/w/' + ws.id + '/s/' + open.dataset.open;
      return;
    }

    const exp = e.target.closest('[data-export]');
    if (exp) { exportBuilderFile(); return; }

    const lesson = e.target.closest('[data-lesson]');
    if (lesson) {
      const l = document.getElementById('lesson-' + cssId(lesson.dataset.lesson));
      if (l) l.classList.toggle('open');
      lesson.classList.toggle('open');
      return;
    }

    const askopen = e.target.closest('[data-askopen]');
    if (askopen) {
      const box = document.getElementById('ask-' + cssId(askopen.dataset.askopen));
      if (box) { box.classList.toggle('open'); const inp = box.querySelector('input'); if (box.classList.contains('open') && inp) inp.focus(); }
      return;
    }

    const cp = e.target.closest('[data-copyprompt]');
    if (cp && !cp.disabled) { copyPortablePrompt(cp); return; }

    const cpr = e.target.closest('[data-copypractice]');
    if (cpr && !cpr.disabled) { copyPortablePrompt(cpr, 'practice'); return; }

    const hr = e.target.closest('[data-hardreset]');
    if (hr) {
      if (!confirm('Hard reset: this erases EVERY answer, artifact, XP point, and streak — all worksheets back to brand new. There is no undo.\n\nErase everything?')) return;
      fetch('/api/reset', { method: 'POST' })
        .then(() => { location.hash = '#/'; location.reload(); })
        .catch(() => alert('Couldn’t reach the local server.'));
      return;
    }

    const sb = e.target.closest('[data-saveboard]');
    if (sb) { const { section, step } = findByKey(sb.dataset.saveboard); saveBoard(section, step); return; }

    // Adding/removing boxes and cards saves IMMEDIATELY — half-finished work
    // survives a closed laptop even if it was never submitted or accepted.
    const ba = e.target.closest('[data-boardadd]');
    if (ba) {
      const k = ba.dataset.boardadd;
      const { step } = findByKey(k);
      const st = serializeBoard(k, step);
      st.board[ba.dataset.side].push('');
      saveState(true);
      route();
      return;
    }

    const bd = e.target.closest('[data-boarddel]');
    if (bd) {
      const k = bd.dataset.boarddel;
      const { step } = findByKey(k);
      const st = serializeBoard(k, step);
      st.board[bd.dataset.side].splice(parseInt(bd.dataset.i, 10), 1);
      st.answer = boardAnswerText(step, st);
      saveState(true);
      route();
      return;
    }

    const la = e.target.closest('[data-listadd]');
    if (la) {
      const k = la.dataset.listadd;
      serializeList(k);
      listRows.set(k, (listRows.get(k) || 0) + 1);
      saveState(true);
      route();
      return;
    }

    const ld = e.target.closest('[data-listdel]');
    if (ld) {
      const k = ld.dataset.listdel;
      const wrap = document.querySelector(`[data-listwrap="${k}"]`);
      const vals = [...wrap.querySelectorAll('.li-input')].map(i => i.value);
      vals.splice(parseInt(ld.dataset.i, 10), 1);
      stepState(k).answer = vals.join('\n');
      listRows.set(k, vals.length);
      saveState(true);
      route();
      return;
    }

    const cfc = e.target.closest('[data-cfclose]');
    if (cfc) { const box = cfc.closest('.copy-fallback'); if (box) box.remove(); return; }

    const savej = e.target.closest('[data-savejournal]');
    if (savej) { const { section, step } = findByKey(savej.dataset.savejournal); saveJournal(section, step); return; }

    const rev = e.target.closest('[data-review]');
    if (rev && !rev.disabled) { const { section, step } = findByKey(rev.dataset.review); submitReview(section, step); return; }

    const send = e.target.closest('[data-asksend]');
    if (send) { const { section, step } = findByKey(send.dataset.asksend); askAssistant(section, step); return; }

    const unm = e.target.closest('[data-unmaster]');
    if (unm) { delete state.mastery[unm.dataset.unmaster]; saveState(true); route(); return; }
  });

  // Persist drafts as they type — plain answers, list rows, and board cards.
  document.addEventListener('input', e => {
    const ta = e.target.closest('[data-draft]');
    if (ta) { stepState(ta.dataset.draft).answer = ta.value; saveState(); return; }

    const li = e.target.closest('.li-input');
    if (li) { serializeList(li.dataset.list); saveState(); return; }

    const bc = e.target.closest('.bd-card');
    if (bc) {
      const k = bc.dataset.board;
      const { step } = findByKey(k);
      const st = stepState(k);
      if (st.board && st.board[bc.dataset.side]) {
        st.board[bc.dataset.side][parseInt(bc.dataset.i, 10)] = bc.value;
        st.answer = boardAnswerText(step, st);
        saveState();
      }
    }
  });

  // Floating back-to-top button.
  const toTop = document.getElementById('toTop');
  if (toTop) {
    window.addEventListener('scroll', () => {
      toTop.classList.toggle('show', window.scrollY > 600);
    }, { passive: true });
    toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  // Enter sends the assistant question.
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.askbox input')) {
      const btn = e.target.closest('.askbox').querySelector('[data-asksend]');
      if (btn) btn.click();
      return;
    }
    // Enter in a list box: save immediately, then hop to the next box —
    // adding a fresh one if they're on the last box and under the max.
    if (e.key === 'Enter' && e.target.matches('.li-input')) {
      e.preventDefault();
      const k = e.target.dataset.list;
      const i = parseInt(e.target.dataset.i, 10);
      serializeList(k);
      saveState(true);
      const wrap = document.querySelector(`[data-listwrap="${k}"]`);
      const inputs = wrap ? [...wrap.querySelectorAll('.li-input')] : [];
      if (i + 1 < inputs.length) { inputs[i + 1].focus(); return; }
      const add = wrap && wrap.querySelector('[data-listadd]');
      if (add) {
        add.click(); // serializes + saves + re-renders
        requestAnimationFrame(() => {
          const w2 = document.querySelector(`[data-listwrap="${k}"]`);
          const ins = w2 ? w2.querySelectorAll('.li-input') : [];
          if (ins.length) ins[ins.length - 1].focus();
        });
      }
    }
  });

  window.addEventListener('hashchange', route);
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  try {
    state = await (await fetch('/api/state', { cache: 'no-store' })).json();
  } catch {
    state = { xp: 0, streak: 0, lastActiveDay: '', steps: {}, artifacts: {}, mastery: {} };
  }
  try {
    const s = await (await fetch('/api/settings', { cache: 'no-store' })).json();
    appSettings.freeRoam = !!s.freeRoam;
  } catch { /* defaults stand */ }
  if (!state.steps) state.steps = {};
  if (!state.artifacts) state.artifacts = {};
  if (!state.mastery) state.mastery = {};
  // Migrate pre-flag states: anything already done has already earned its XP.
  for (const st of Object.values(state.steps)) {
    if (st.status === 'done' && st.xpAwarded === undefined) st.xpAwarded = true;
  }

  // margin gears + header
  const G = window.BuildersGears;
  $('.mg-l1').innerHTML = G.gearSVG({ teeth: 12, color: '#181a1f', fill: '#4886f3', stroke: 2.5, bolts: 5, size: 150 });
  $('.mg-l2').innerHTML = G.gearSVG({ teeth: 9, color: '#181a1f', fill: '#fddf67', stroke: 2.5, bolts: 3, size: 96 });
  $('.mg-r1').innerHTML = G.gearSVG({ teeth: 14, color: '#181a1f', fill: '#ff635e', stroke: 2.5, bolts: 6, size: 180 });
  $('.mg-r2').innerHTML = G.gearSVG({ teeth: 8, color: '#181a1f', fill: '#ffffff', stroke: 2.5, bolts: 0, size: 88 });
  G.initScrollGears();

  wire();
  route();
}

boot();

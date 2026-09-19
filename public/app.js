/* Builders Club — semester worksheets: hash router, hub/flow views, AI review.
   Per-student, behind a school Microsoft sign-in. */
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

/* The extras shelf (bottom of the home page) is bonus material: it counts for
   nothing — no XP, no artifact tally — and every step is open from day one. */
function isExtraSection(section) {
  const ws = wsOfSection(section.id);
  return !!(ws && ws.extra);
}

// The "+N XP" badge on a done stamp — extras earn nothing, so they show nothing.
function xpPill(section, n) {
  return isExtraSection(section) ? '' : `<span class="xpgain">+${n} XP</span>`;
}

// True when steps in this section can be done in any order: either the student
// turned free roam on globally, or the worksheet is free-roam by design.
function roams(section) {
  if (appSettings.freeRoam) return true;
  const ws = wsOfSection(section.id);
  return !!(ws && ws.freeRoam);
}

/* ---------------------------------------------------------------- session */

let me = null;          // { name, email, role } once signed in

/* Every call goes through here so an expired sign-in is handled in one place.
   A 401 raises the banner and throws — it never redirects and never re-renders,
   because a student mid-answer must not lose what they have typed. */
class AuthError extends Error {
  constructor() { super('unauthenticated'); this.name = 'AuthError'; }
}

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ cache: 'no-store' }, opts));
  if (res.status === 401) { showAuthBanner(); throw new AuthError(); }
  hideAuthBanner();
  return res;
}

function showAuthBanner() {
  const b = document.getElementById('authBanner');
  if (b) b.hidden = false;
}

function hideAuthBanner() {
  const b = document.getElementById('authBanner');
  if (b) b.hidden = true;
}

/* ---------------------------------------------------------------- state */

let state = null;
let saveTimer = null;
let appSettings = { freeRoam: false }; // refreshed from /api/settings at boot and on settings changes

function saveState(immediate) {
  if (viewingAs) return Promise.resolve(); // an instructor reading a student's work never writes to it
  clearTimeout(saveTimer);
  saveTimer = null;
  const doSave = () => api('/api/state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
  }).catch(() => {});
  if (immediate) return doSave();
  saveTimer = setTimeout(doSave, 500);
}

/* Write out anything the 500ms debounce is still holding. Called before the
   page starts showing someone else's work: a timer that fired afterwards would
   post whatever `state` points at by then — the wrong person's answers. */
function flushPendingSave() {
  if (!saveTimer) return Promise.resolve();
  clearTimeout(saveTimer);
  saveTimer = null;
  return saveState(true);
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
  if (ws.freeRoam) return true; // extras: dip in anywhere
  if (ws.sections[i].alwaysUnlocked) return true; // e.g. the Ship It setup walkthrough — needed mid-semester, no content dependency
  return i === 0 || sectionDone(ws.sections[i - 1]);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function awardXP(n) {
  state.xp += n;
  if (state.lastActiveDay !== todayStr()) { state.streak += 1; state.lastActiveDay = todayStr(); }
  updateHeader();
}

// XP is earned once per step — redoing a step never re-awards it. Extras award
// nothing at all, so nothing about the bonus shelf can inflate the header.
function awardStepXP(st, n, section) {
  if (section && isExtraSection(section)) return;
  if (st.xpAwarded) return;
  st.xpAwarded = true;
  awardXP(n);
}

/* ---------------------------------------------------------------- header */

function updateHeader() {
  let done = 0, total = 0;
  for (const w of WORKSHEETS) {
    if (w.extra) continue; // the bonus shelf is not part of the semester's count
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
  renderRoute();
  // Every render rebuilds these from scratch, so re-fit them to their text.
  sizeListBoxes();
  sizeRecapBoxes();
  // readOnly (not disabled) keeps the text selectable and copyable while
  // stopping the input events that would otherwise write to the student's work.
  if (viewingAs) document.querySelectorAll('#view textarea').forEach(t => { t.readOnly = true; });
}

function renderRoute() {
  activeGates.forEach(g => g.destroy());
  activeGates = [];
  const h = location.hash || '#/';
  const newRoute = h !== lastRouteHash;
  lastRouteHash = h;
  const startAtTop = () => { if (newRoute) window.scrollTo({ top: 0, behavior: 'instant' }); };

  if (h.startsWith('#/instructor')) {
    if (!me || me.role !== 'instructor') { location.hash = '#/'; return; }
    const m2 = h.match(/^#\/instructor\/([\w-]+)/);
    if (m2) { enterViewingAs(m2[1]); return; }
    leaveViewingAs();
    renderRoster();
    startAtTop();
    return;
  }

  // Settings writes, so it always runs as yourself.
  if (h.startsWith('#/settings')) { leaveViewingAs(); renderSettings(); startAtTop(); return; }

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
      // Coming back from a section: don't land on a closed drawer, either kind.
      if (ws.extra) setFold(ws.id, true); else setBlockClosed(ws.id, false);
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

/* Which extras dropdowns are expanded — survives navigation and reloads. */
const openFolds = new Set(JSON.parse(localStorage.getItem('bc.folds') || '[]'));
function setFold(id, open) {
  if (open) openFolds.add(id); else openFolds.delete(id);
  localStorage.setItem('bc.folds', JSON.stringify([...openFolds]));
}

/* Core worksheets are open by default — assigned work shouldn't hide itself — so
   we remember the CLOSED ones, the inverse of how extras track their folds. */
const closedBlocks = new Set(JSON.parse(localStorage.getItem('bc.blocksClosed') || '[]'));
function setBlockClosed(id, closed) {
  if (closed) closedBlocks.add(id); else closedBlocks.delete(id);
  localStorage.setItem('bc.blocksClosed', JSON.stringify([...closedBlocks]));
}

// One big page: every worksheet with all of its section cards.
function renderHome() {
  const view = $('#view');
  view.classList.remove('wide');

  const block = (w, i) => {
    const done = w.sections.filter(sectionDone).length;
    const allDone = done === w.sections.length;
    return `
    <details class="ws-block${i === 0 ? ' is-first' : ''}" id="ws-${w.id}" data-block="${w.id}"${closedBlocks.has(w.id) ? '' : ' open'}>
      <summary class="ws-head">
        <h2 class="ws-title">${esc(w.title)}<span class="ws-chev" aria-hidden="true">▾</span></h2>
        <p class="ws-sub">${esc(w.subtitle || '')} <span class="ws-count">${done}/${w.sections.length} artifacts</span></p>
      </summary>
      ${allDone ? `
      <section class="section is-done finale">
        <div class="trophy">🏆</div>
        <h2 class="sec-title" style="margin-top:8px">${esc(w.title)}: complete.</h2>
        <p class="sec-tagline">All ${w.sections.length} artifacts earned. Download your builder file and bring it to your mentor.</p>
        <div class="answer-tools" style="justify-content:center"><button class="btn green" data-export>Download Builder File ⬇</button></div>
      </section>` : ''}
      ${w.sections.map((s, i) => sectionCardHTML(w, s, i)).join('')}
    </details>`;
  };

  // Extras collapse into a dropdown each — they shouldn't cost the student a
  // screen of scrolling on the way to the work that's actually assigned.
  const fold = (w, i) => {
    const done = w.sections.filter(sectionDone).length;
    return `
    <details class="ws-fold${i === 0 ? ' is-first' : ''}" id="ws-${w.id}" data-fold="${w.id}"${openFolds.has(w.id) ? ' open' : ''}>
      <summary class="wf-head">
        <span class="wf-badge">EXTRA</span>
        <span class="wf-title">${esc(w.title)}</span>
        <span class="wf-count">${done}/${w.sections.length}</span>
        <span class="wf-chev" aria-hidden="true">▾</span>
      </summary>
      <div class="wf-body">${w.sections.map((s, i) => sectionCardHTML(w, s, i)).join('')}</div>
    </details>`;
  };

  const core = WORKSHEETS.filter(w => !w.extra).map(block).join('');
  const extras = WORKSHEETS.filter(w => w.extra).map(fold).join('');


  view.innerHTML = `
    <section class="hero">
      <span class="kicker">BUILDERS CLUB · ONE SEMESTER</span>
      <h1>Your<br>Worksheets</h1>
    </section>
    ${core}
    ${extras}`;
  updateHeader();
}

/* ---------------------------------------------------------------- instructor view

   An instructor opens a student's worksheets by loading that student's state
   into the same renderer the student uses. `viewingAs` is the switch: while it
   is set, saveState is a no-op, every writing control is hidden, and videos
   don't mount — so reading someone's work can never change it. */

let viewingAs = null;   // { oid, name, email } while inspecting a student
let ownState = null;    // the instructor's own state, put back on the way out
let rosterCache = null; // last roster payload, so a deep link can resolve a name

async function loadRoster() {
  const { students } = await (await api('/api/instructor/students')).json();
  rosterCache = students || [];
  return rosterCache;
}

function ago(ts) {
  if (!ts) return 'never';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  return new Date(ts).toLocaleDateString();
}

// Denominators for the roster, counted the same way the header does: the bonus
// shelf is not part of the semester.
function semesterTotals() {
  let steps = 0, sections = 0;
  for (const w of WORKSHEETS) {
    if (w.extra) continue;
    sections += w.sections.length;
    for (const sec of w.sections) steps += sec.steps.length;
  }
  return { steps, sections };
}

async function renderRoster() {
  const view = $('#view');
  view.classList.remove('wide');
  view.innerHTML = `
    <div class="flow-topbar"><a class="crumb" href="#/">\u25c2 Worksheets</a></div>
    <section class="hero compact"><h1>Students</h1></section>
    <section class="section is-active" id="roster-card"><p class="sec-tagline">Loading\u2026</p></section>`;

  let students;
  try { students = await loadRoster(); }
  catch (e) {
    const card = $('#roster-card');
    if (card) card.innerHTML = `<p class="sec-tagline">${e.name === 'AuthError' ? 'Your sign-in expired \u2014 sign in again to see the roster.' : 'Couldn\u2019t load the roster \u2014 check your connection and try again.'}</p>`;
    return;
  }

  const card = $('#roster-card');
  if (!card) return; // navigated away while loading
  if (!students.length) {
    card.innerHTML = '<p class="sec-tagline">No students have signed in yet.</p>';
    return;
  }

  const totals = semesterTotals();
  // Class-code students have no email, so that column would be dead space.
  const anyEmail = students.some(st => st.email);
  card.innerHTML = `
    <p class="sec-tagline">${students.length} student${students.length === 1 ? '' : 's'} signed in so far \u00b7 click anyone to read their worksheets</p>
    <div class="table-wrap"><table class="roster">
      <thead><tr>
        <th>Name</th>${anyEmail ? '<th class="r-email">Email</th>' : ''}<th>Steps</th><th>XP</th><th>Artifacts</th><th>Last seen</th><th></th>
      </tr></thead>
      <tbody>${students.map(st => `
        <tr data-student="${esc(st.oid)}">
          <td class="r-name">${esc(st.name)}</td>
          ${anyEmail ? `<td class="r-email">${esc(st.email)}</td>` : ''}
          <td class="r-num">${st.stepsDone}/${totals.steps}</td>
          <td class="r-num">${st.xp}</td>
          <td class="r-num">${st.artifacts}/${totals.sections}</td>
          <td class="r-num" title="${esc(new Date(st.lastSeen || 0).toLocaleString())}">${esc(ago(st.lastSeen))}</td>
          <td><button class="ask-btn" data-dl="${esc(st.oid)}" title="Download this student\u2019s Builder file">\u2b07</button></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function showViewBanner() {
  const b = document.getElementById('viewBanner');
  const n = document.getElementById('viewName');
  if (n && viewingAs) n.textContent = viewingAs.name || viewingAs.email || 'this student';
  if (b) b.hidden = false;
}

function hideViewBanner() {
  const b = document.getElementById('viewBanner');
  if (b) b.hidden = true;
}

async function enterViewingAs(oid) {
  const hashAtStart = location.hash;
  // Every await below is a chance for the student to click Back, so re-check
  // that this is still the view they want before touching anything.
  const stillWanted = () => location.hash === hashAtStart;

  // Settle our own work before `state` starts pointing at someone else's.
  if (inflightWork) { try { await inflightWork; } catch { /* the review reports its own failure */ } }
  await flushPendingSave();
  if (!stillWanted()) return;

  if (!rosterCache) {
    try { await loadRoster(); } catch { if (stillWanted()) location.hash = '#/instructor'; return; }
    if (!stillWanted()) return;
  }
  const row = (rosterCache || []).find(r => r.oid === oid);
  if (!row) { location.hash = '#/instructor'; return; }

  let loaded;
  try {
    loaded = await (await api(`/api/instructor/students/${encodeURIComponent(oid)}/state`)).json();
  } catch { if (stillWanted()) location.hash = '#/instructor'; return; }
  if (!stillWanted()) return;

  if (!viewingAs) ownState = state;   // first hop in — remember our own work
  viewingAs = row;
  state = normalizeState(loaded);
  // Per-section view memory belongs to whoever we were looking at before.
  focusView.clear(); listRows.clear(); threadOpen.clear();
  document.body.classList.add('readonly');
  showViewBanner();
  renderHome();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function leaveViewingAs() {
  if (!viewingAs) return;
  state = ownState;
  ownState = null;
  viewingAs = null;
  focusView.clear(); listRows.clear(); threadOpen.clear();
  document.body.classList.remove('readonly');
  hideViewBanner();
  updateHeader();
}

/* Controls that would write something. While viewing a student they are hidden
   by CSS; this is the belt to that braces, in case a click lands anyway. */
const MUTATING_SEL = '[data-review],[data-savejournal],[data-saveboard],[data-redo],[data-redostep],'
  + '[data-unmaster],[data-copyprompt],[data-copypractice],[data-boardadd],[data-boarddel],'
  + '[data-listadd],[data-listdel],[data-importmd],[data-showbackups],[data-restorebackup],'
  + '[data-hardreset],[data-freeroam],[data-backend]';

/* ---------------------------------------------------------------- settings view */

async function renderSettings() {
  const view = $('#view');
  view.classList.remove('wide');
  view.innerHTML = `
    <div class="flow-topbar"><a class="crumb" href="#/">◂ Worksheets</a></div>
    <section class="hero compact"><h1>Settings</h1></section>
    <section class="section is-active" id="settings-card"><p class="sec-tagline">Loading…</p></section>`;
  let s = null;
  try { s = await (await api('/api/settings')).json(); } catch { /* offline or signed out */ }
  const card = $('#settings-card');
  if (!card) return; // user navigated away while loading
  if (!s) { card.innerHTML = '<p class="sec-tagline">Couldn’t load your settings — check your connection and try again.</p>'; return; }
  appSettings.freeRoam = !!s.freeRoam;
  card.innerHTML = settingsCardHTML(s);
  card.insertAdjacentHTML('afterend', progressCardHTML(s) + dataCardHTML() + dangerCardHTML());
  updateHeader();
}

/* The Builder file is BOTH the submission and the manual fallback: download it to
   hand in or keep safe, upload one to restore that work into your account. */
function dataCardHTML() {
  return `
  <section class="section is-active">
    <div class="sec-headtext">
      <div class="sec-kicker">BACKUP</div>
      <h2 class="sec-title">Manage your data</h2>
    </div>
    <div class="backup-row">
      <button class="btn" data-export>⬇ Download Builder file</button>
      <button class="btn white" data-importmd>⬆ Upload Builder file</button>
      <input type="file" id="importFile" accept=".md,text/markdown" style="display:none">
    </div>
    <button class="backup-restore" data-showbackups><span class="br-icon">↺</span>Restore a backup</button>
    <div id="backupList"></div>
  </section>`;
}

/* The server snapshots state right before every completed / submitted / redone
   step (data/backups/). This lists recent ones so any accident is a 2-click undo. */
async function showBackupList() {
  const box = document.getElementById('backupList');
  if (!box) return;
  let list = [];
  try { list = (await (await api('/api/backups')).json()).backups || []; } catch { /* offline or signed out */ }
  if (!list.length) {
    box.innerHTML = '<p class="sec-tagline">No automatic backups yet — they appear as soon as steps get completed or submitted.</p>';
    return;
  }
  box.innerHTML = `<div class="opt-list">${list.map(b => `
    <button class="opt" data-restorebackup="${esc(b.file)}">
      <span class="opt-main">
        <span class="opt-title">${esc(new Date(b.ts).toLocaleString())}</span>
        <span class="opt-desc">${b.done} completed step${b.done === 1 ? '' : 's'} · ${b.xp} XP</span>
      </span>
    </button>`).join('')}</div>`;
}

async function restoreBackup(file, label) {
  if (!confirm(`Roll your account back to the snapshot from ${label}? Today's progress is snapshotted first, so this can itself be undone.`)) return;
  try {
    const r = await (await api('/api/backups/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }),
    })).json();
    if (!r.ok) throw new Error('restore failed');
  } catch {
    alert('Couldn’t restore that backup — check your connection and try again.');
    return;
  }
  location.hash = '#/';
  location.reload();
}

/* Rebuild state from an exported Builder file. Matches worksheets, sections, and
   steps by TITLE — the same titles the export writes. What a Builder file never
   contains (in-progress answers, AI feedback threads) can't come back from one. */
function parseBuilderFile(text) {
  const lines = String(text).split(/\r?\n/);
  if (!/^# Builders Club — Builder File/.test(lines[0] || '')) return null;
  const s = { meta: { version: 1, updatedAt: Date.now() }, xp: 0, streak: 0, lastActiveDay: '', steps: {}, artifacts: {}, mastery: {} };
  const head = lines.find(l => l.startsWith('_Exported'));
  const hm = head && head.match(/·\s*(\d+)\s*XP\s*·\s*(\d+)-day/);
  if (hm) { s.xp = +hm[1]; s.streak = +hm[2]; }

  let ws = null, section = null, step = null, buf = [], attempts = 0, mastered = null, watched = false;

  const flush = () => {
    if (section && step) {
      const k = keyOf(section, step);
      if (mastered !== null) {
        s.mastery[k] = { reason: mastered, ts: Date.now() };
      } else {
        while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
        while (buf.length && !buf[0].trim()) buf.shift();
        const st = { status: 'done', answer: watched ? '' : buf.join('\n'), attempts, thread: [], xpAwarded: true };
        if (attempts > 0) st.verdict = { pass: true, ts: Date.now() };
        if (step.board) { // rebuild the card columns from their serialized text
          const cols = boardCols(step);
          st.board = {};
          let cur = null;
          for (const line of st.answer.split('\n')) {
            const col = cols.find(c => line.toUpperCase().startsWith(c.label.toUpperCase() + ' ('));
            if (col) { cur = col.key; st.board[cur] = []; continue; }
            if (cur && line.startsWith('- ') && line !== '- (none yet)') st.board[cur].push(line.slice(2));
          }
          ensureBoard(st, cols);
        }
        if (step.fields) st.fields = fieldsFromAnswer(step, st.answer); // rebuild the boxes from their serialized text
        s.steps[k] = st;
      }
    }
    step = null; buf = []; attempts = 0; mastered = null; watched = false;
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^### (.+)/))) { flush(); step = section ? section.steps.find(x => x.title === m[1]) || null : null; continue; }
    if ((m = line.match(/^## (\d+)\. (.+)/))) { flush(); section = ws ? ws.sections.find(x => x.title === m[2]) || null : null; continue; }
    if ((m = line.match(/^# (.+)/))) { flush(); ws = WORKSHEETS.find(w => w.title === m[1]) || null; section = null; continue; }
    if (!step && section && line.startsWith('> **')) { // the section's artifact blockquote
      const quoted = [];
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith('>')) { quoted.push(lines[j].replace(/^> ?/, '')); j++; }
      while (quoted.length && !quoted[0].trim()) quoted.shift();
      s.artifacts[section.id] = quoted.join('\n').trim();
      i = j - 1;
      continue;
    }
    if (!step) continue;
    if (/^\*\*Task:\*\*/.test(line)) continue;
    if (/^_Watched segment /.test(line)) { watched = true; continue; }
    if ((m = line.match(/^_Mastered — skipped\. (.*)_$/))) { mastered = m[1]; continue; }
    if ((m = line.match(/^_Accepted by Builders AI after (\d+) attempt/))) { attempts = +m[1]; continue; }
    buf.push(line);
  }
  flush();
  return s;
}

async function importBuilderFile(input) {
  const file = input.files && input.files[0];
  input.value = ''; // allow picking the same file again later
  if (!file) return;
  const data = parseBuilderFile(await file.text());
  if (!data) { alert('That doesn’t look like a Builder file — pick the .md file downloaded from this page.'); return; }
  const n = Object.values(data.steps).filter(st => st.status === 'done').length;
  if (!n && !Object.keys(data.mastery).length) { alert('No completed steps found in that Builder file.'); return; }
  if (!confirm(`Restore from this Builder file? It holds ${n} completed step${n === 1 ? '' : 's'} and ${data.xp} XP. Everything currently in your account will be replaced by it.`)) return;
  state = data;
  await saveState(true);
  location.hash = '#/';
  location.reload();
}

function dangerCardHTML() {
  return `
  <section class="section is-active">
    <div class="sec-headtext">
      <div class="sec-kicker">DANGER ZONE</div>
      <h2 class="sec-title">Start completely over</h2>
    </div>
    <p class="sec-tagline">Erases every answer, artifact, review thread, XP point, and streak in your account — all worksheets back to brand new. There is no undo.</p>
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

const ENGINE_LABEL = { codex: 'OpenAI', claude: 'Anthropic Claude' };

function settingsCardHTML(s) {
  const head = `
    <div class="sec-headtext">
      <div class="sec-kicker">AI REVIEWER</div>
      <h2 class="sec-title">Which engine reviews the work</h2>
    </div>`;

  /* Only one API key configured means there is nothing to choose between — show
     what's running instead of a picker that can't do anything. (An older server
     sends no canChooseEngine at all; treat that as "show the picker".) */
  if (s.canChooseEngine === false) {
    return head + `<p class="active-note">${s.activeAvailable
      ? `Reviews run on <b>${esc(ENGINE_LABEL[s.active] || s.active)}</b>, set up by your instructor.`
      : 'No AI reviewer is set up yet — ask your instructor.'}</p>`;
  }

  const status = e => e.available
    ? `<span class="chip ok">ready ✓</span>`
    : `<span class="chip warn">not configured</span>`;
  const opts = [
    { v: 'codex', title: 'Codex', desc: 'OpenAI’s models, over the API.', chip: status(s.engines.codex) },
    { v: 'claude', title: 'Claude', desc: 'Anthropic’s Claude, over the API.', chip: status(s.engines.claude) },
  ];
  // Accounts that saved the old 'auto' setting show whichever engine it resolved to.
  const sel = s.reviewBackend === 'auto' ? s.active : s.reviewBackend;
  return head + `
    <div class="opt-list">
      ${opts.map(o => `
      <button class="opt ${sel === o.v ? 'sel' : ''}" data-backend="${o.v}">
        <span class="opt-radio">${sel === o.v ? '●' : ''}</span>
        <span class="opt-main">
          <span class="opt-title">${o.title}</span>
          <span class="opt-desc">${o.desc}</span>
        </span>
        ${o.chip}
      </button>`).join('')}
    </div>`;
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
  // A url starting with '#' points at another worksheet in here — same tab, own block.
  const rows = rs => rs.map(r => `<a class="rs-link" href="${esc(r.url)}"${r.url[0] === '#' ? '' : ' target="_blank" rel="noopener"'}>${esc(r.title)}</a>${r.note ? `<span class="rs-note">— ${esc(r.note)}</span>` : ''}`).join('<br>');
  const ext = step.resources.filter(r => r.url[0] !== '#');
  const int = step.resources.filter(r => r.url[0] === '#');
  return `
    ${ext.length ? `<div class="resources"><span class="rs-label">📚 Go deeper</span>${rows(ext)}</div>` : ''}
    ${int.length ? `<div class="resources is-internal"><span class="rs-label">🎁 On the extras shelf</span>${rows(int)}</div>` : ''}`;
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
      <textarea class="li-input" rows="1" data-list="${k}" data-i="${i}" placeholder="${esc(cfg.placeholder || '')}">${esc(t)}</textarea>
      ${items.length > 1 ? `<button class="li-del" data-listdel="${k}" data-i="${i}" title="Remove this one">✕</button>` : ''}
    </div>`).join('');
  return `<div class="list-answer" data-listwrap="${k}">
    ${rows}
    ${items.length < cfg.max ? `<button class="li-add-row" data-listadd="${k}" title="Add another"><span class="li-num">+</span><span class="li-add-box">Add ${esc((cfg.itemLabel || 'item').toLowerCase())}</span></button>` : ''}
  </div>`;
}

function serializeList(k) {
  const wrap = document.querySelector(`[data-listwrap="${k}"]`);
  if (!wrap) return;
  const vals = [...wrap.querySelectorAll('.li-input')].map(i => i.value);
  stepState(k).answer = vals.join('\n');
}

/* Grow a textarea to fit its own text. Collapse to 0 first so scrollHeight
   reports the true content height and the box can shrink again on delete;
   scrollHeight excludes borders under border-box, so add them back. */
function autoGrow(ta) {
  const cs = getComputedStyle(ta);
  const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  ta.style.height = '0px';
  ta.style.height = (ta.scrollHeight + border) + 'px';
}

/* Re-fit every list box on screen, and watch each list for width changes:
   a narrower column rewraps the text into more lines, and because the boxes
   hide their overflow a stale height would clip the last line outright.
   Only WIDTH matters — reacting to height would loop, since we set it. */
let listWidths = new WeakMap();
const listObserver = window.ResizeObserver ? new ResizeObserver(entries => {
  for (const en of entries) {
    const w = en.contentRect.width;
    if (listWidths.get(en.target) === w) continue;
    listWidths.set(en.target, w);
    en.target.querySelectorAll('.li-input').forEach(autoGrow);
  }
}) : null;

function sizeListBoxes() {
  document.querySelectorAll('.li-input').forEach(autoGrow);
  if (!listObserver) return;
  // Every render throws the old boxes away, so re-point the observer.
  listObserver.disconnect();
  listWidths = new WeakMap();
  document.querySelectorAll('.list-answer').forEach(w => listObserver.observe(w));
}

/* "Building on" recap cards hug a short answer and cap a long one, which then
   scrolls. The cap is an inline height rather than a CSS max-height: max-height
   would also clamp the resize handle, so a student couldn't drag the card taller
   to read the whole thing. Only run on render — re-running would snap a card
   the student had dragged open back down to the cap. */
const RECAP_CAP = 120;
function sizeRecapBoxes() {
  document.querySelectorAll('.bo-text').forEach(box => {
    box.style.height = '';                 // measure the text unconstrained
    const natural = box.scrollHeight;
    const capped = natural > RECAP_CAP;
    // only a capped card is hiding anything, so only it gets the drag handle
    box.classList.toggle('is-capped', capped);
    box.style.height = (capped ? RECAP_CAP : natural) + 'px';
  });
}

/* ---- multi-box answers (step.fields) ------------------------------------

   fields: [{ id, label, placeholder?, prefill?, minLines? }, …] — one labelled
   textarea per entry instead of a single answer box. A `prefill` seeds the box
   with a template the student edits in place (blanks to replace), so it has to
   be real text, not a placeholder. st.fields holds the boxes; st.answer stays
   the single serialized string everything else already reads (review prompt,
   buildsOn digests, artifacts, the Builder file). */

function fieldsAnswerText(step, st) {
  return step.fields
    .map(f => `${f.label.toUpperCase()}:\n${(st.fields[f.id] || '').trim()}`)
    .join('\n\n');
}

// Split a serialized answer back into boxes. Anything before the first header
// (an older single-box answer, a hand-edited Builder file) lands in box one.
function fieldsFromAnswer(step, answer) {
  const out = {};
  let cur = step.fields[0].id;
  for (const line of String(answer || '').split('\n')) {
    const f = step.fields.find(x => line.toUpperCase().trim() === x.label.toUpperCase() + ':');
    if (f) { cur = f.id; out[cur] = out[cur] || ''; continue; }
    out[cur] = out[cur] === undefined ? line : out[cur] + '\n' + line;
  }
  for (const f of step.fields) out[f.id] = (out[f.id] || '').trim();
  return out;
}

function ensureFields(st, step) {
  if (!st.fields) {
    st.fields = (st.answer || '').trim()
      ? fieldsFromAnswer(step, st.answer)
      : Object.fromEntries(step.fields.map(f => [f.id, f.prefill || '']));
    st.answer = fieldsAnswerText(step, st);
  }
  for (const f of step.fields) if (typeof st.fields[f.id] !== 'string') st.fields[f.id] = f.prefill || '';
  return st;
}

function serializeFields(k, step) {
  const st = stepState(k);
  ensureFields(st, step);
  const card = document.getElementById('step-' + cssId(k));
  if (card) {
    for (const f of step.fields) {
      const ta = card.querySelector(`.answer[data-field="${f.id}"][data-fieldstep="${k}"]`);
      if (ta) st.fields[f.id] = ta.value;
    }
  }
  st.answer = fieldsAnswerText(step, st);
  return st;
}

function fieldsHTML(step, st, k) {
  ensureFields(st, step);
  return step.fields.map((f, i) => `
    <div class="field-box${i ? ' stacked' : ''}">
      <label class="field-label" for="ta-${cssId(k)}-${f.id}">${esc(f.label)}</label>
      <textarea class="answer" id="ta-${cssId(k)}-${f.id}" data-field="${f.id}" data-fieldstep="${k}"
        placeholder="${esc(f.placeholder || '')}">${esc(st.fields[f.id] || '')}</textarea>
    </div>`).join('');
}

// Shakes the first box that's short of its own minimum. Returns false after an
// immediate save, so a failed check never loses what they typed.
function fieldsMeetMinimums(k, step, st) {
  for (const f of step.fields) {
    const lines = (st.fields[f.id] || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (f.minLines && lines.length < f.minLines) {
      const ta = document.querySelector(`.answer[data-field="${f.id}"][data-fieldstep="${k}"]`);
      if (ta) { ta.classList.add('shake'); setTimeout(() => ta.classList.remove('shake'), 420); ta.focus(); }
      saveState(true);
      return false;
    }
  }
  return true;
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
       <button class="btn" data-review="${k}">${st.attempts > 0 ? 'Resubmit ▸' : 'Submit & Review'}</button>
       ${reqNote}`
    : `${step.lessonPanel ? `<button class="ask-btn" data-lesson="${k}">📖 Lesson</button>` : ''}
       <button class="btn" data-saveboard="${k}">${done ? 'Save new cards' : 'Save scoreboard'}</button>
       ${!done ? reqNote : ''}`;
  return `
    ${done && reviewed ? `<button class="redo-btn" data-redostep="${k}" title="Clear this step and do it again">↻ Redo</button>` : ''}
    ${done ? `<div class="done-stamp"><span class="big">${doneLabel}</span>${xpPill(section, step.xp || 15)}</div>` : ''}
    ${buildsOnHTML(section, step)}
    ${lessonHTML(step, k)}
    <div class="board cols-${cols.length}">${cols.map(col).join('')}</div>
    <div class="answer-tools">${actions}</div>
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
        <div class="done-stamp"><span class="big">Segment complete ✓</span>${xpPill(section, step.xp || 20)}</div>
        ${step.videoRecap ? `<div class="recap"><h4>What that segment gave you</h4><ul>${step.videoRecap.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
        ${resourcesHTML(step)}`;
    }
    // Resources stay visible after the step is done — that's often exactly when
    // the follow-on reading (and the extras cross-links) is worth clicking.
    return `${redoBtn}
      ${guide}
      <div class="prev-answer"><span class="pa-label">Your accepted answer</span>${esc(st.answer)}</div>
      ${threadHTML(st, k)}
      <div class="done-stamp"><span class="big">${step.isArtifact ? 'Artifact earned ✓' : 'Step complete ✓'}</span>${xpPill(section, (step.xp || 15) + (step.isArtifact ? (section.xp || 0) : 0))}</div>
      ${resourcesHTML(step)}`;
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

  const answerField = step.fields
    ? fieldsHTML(step, st, k)
    : cfg
      ? listAnswerHTML(step, st, k)
      : `<textarea class="answer" id="ta-${id}" data-draft="${k}" placeholder="${esc(step.placeholder || 'Write your answer here…')}">${esc(st.answer || '')}</textarea>`;

  return `
    ${buildsOnHTML(section, step)}
    ${guide}
    ${lessonHTML(step, k)}
    <div class="answer-wrap">
      ${step.practice ? `<button class="btn practice-copy" data-copypractice="${k}">🎙 Copy the practice-interview setup</button>` : ''}
      ${step.fields ? '' : `<label class="field-label" for="ta-${id}">${fieldLabel}</label>`}
      ${answerField}
      <div class="answer-tools">
        ${step.lessonPanel ? `<button class="ask-btn" data-lesson="${k}">📖 Lesson</button>` : ''}
        ${!isJournal ? `<button class="ask-btn" data-copyprompt="${k}" title="Copy this whole step — task, checklist, and your work so far — as a prompt you can paste into any AI chat">📋 Copy for another AI</button>` : ''}
        ${isJournal
          ? `<button class="btn" data-savejournal="${k}">Save entry</button>`
          : `<button class="btn" data-review="${k}">${st.attempts > 0 ? 'Resubmit ▸' : 'Submit & Review'}</button>`}
        ${reqNote}
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
  if (roams(section)) return true;
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
  else if (idx === activeIdx || roams(section)) status = 'active';
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
      ${status !== 'locked' ? `<p class="sec-prompt">${mdInline(step.prompt)}</p>` : ''}
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
    else if (i === activeIdx || roams(section)) status = 'active';
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
      ${status !== 'locked' ? `<p class="sec-prompt">${mdInline(step.prompt)}</p>` : ''}
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
    if (i === activeIdx || roams(section)) mountVideo(section, step);
  });
  maybeAutoDraft(section);
  updateHeader();
}

/* ---------------------------------------------------------------- video wiring */

function mountVideo(section, step) {
  if (viewingAs) return; // a gate that completed would mutate the work being read
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
  if (viewingAs) return;
  const k = keyOf(section, step);
  const st = stepState(k);
  if (st.status === 'done') return;
  st.status = 'done';
  awardStepXP(st, step.xp || 20, section);
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
  awardStepXP(st, gained, section);
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
  awardStepXP(st, step.xp || 15, section);
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
  document.querySelectorAll(`.answer[data-fieldstep="${k}"]`).forEach(n => {
    n.disabled = busy; n.classList.toggle('dimmed', busy);
  });
}

/* Resolves while an AI submission is in flight. The verdict handler below writes
   into whatever `state` points at, so anything that would repoint it (an
   instructor opening a student) waits for this first. */
let inflightWork = null;

async function submitReview(section, step) {
  let done;
  inflightWork = new Promise(r => { done = r; });
  try {
    return await submitReviewInner(section, step);
  } finally {
    inflightWork = null;
    done();
  }
}

async function submitReviewInner(section, step) {
  const k = keyOf(section, step);
  const st = stepState(k);
  const id = cssId(k);
  const ta = document.getElementById('ta-' + id);
  const btn = document.querySelector(`[data-review="${k}"]`);

  let val;
  if (step.fields) {
    serializeFields(k, step); // captures every box into st.fields + st.answer, pass or fail
    if (!fieldsMeetMinimums(k, step, st)) return;
    val = st.answer;
  } else if (step.board) {
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
    const res = await api('/api/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectionId: section.id, stepId: step.id, answer: val, attempt: st.attempts,
        lastFeedback: st.lastFeedback || '',
        // The whole run of notes so far — without it the reviewer can't tell it's
        // already asked for something, and the bar drifts every round.
        priorFeedback: st.thread.filter(m => m.role === 'agent' && m.kind !== 'offline').map(m => m.text),
      }),
    });
    verdict = await res.json();
  } catch (e) {
    // An expired sign-in and a dropped connection get different advice, but
    // both come back as an `offline` round that costs the student no attempt.
    verdict = {
      pass: false, offline: true,
      feedback: e.name === 'AuthError'
        ? 'Your sign-in expired. Use the banner at the top to sign in again, then resubmit — this attempt wasn’t counted.'
        : 'Couldn’t reach Builders AI — check your connection and try again. This attempt wasn’t counted.',
      reasons: [], hint: '', masteryFlags: [],
    };
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
    awardStepXP(st, gained, section);
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

/* ---------------------------------------------------------------- draft */

async function draftFromWork(section, step) {
  const k = keyOf(section, step);
  const st = stepState(k);
  const ta = document.getElementById('ta-' + cssId(k));

  setAnswerBusy(k, true);
  if (ta && !ta.value.trim()) ta.placeholder = '✍️ Assembling a first draft from your own work — a few seconds…';

  let text = '';
  try {
    const res = await api('/api/assist', {
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
  if (viewingAs) return; // never spend a draft call on someone else's step
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
// kind 'review' = get feedback when the reviewer is down;
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
    const res = await api('/api/prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectionId: section.id, stepId: step.id, kind: kind || 'review',
        answer: ta ? ta.value.trim() : (st.answer || ''),
        attempt: st.attempts + 1, lastFeedback: st.lastFeedback || '',
        priorFeedback: st.thread.filter(m => m.role === 'agent' && m.kind !== 'offline').map(m => m.text),
      }),
    });
    prompt = (await res.json()).prompt;
  } catch {
    btn.textContent = '✗ Couldn’t reach the server — try again';
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
  if (!confirm(`Redo “${section.title}”? Every step resets, but your answers stay in their boxes.${warn}`)) return;

  for (const step of section.steps) {
    const k = keyOf(section, step);
    const st = state.steps[k];
    if (!st && !state.mastery[k]) continue;
    // Reset the PROGRESS, never the words — a redo must not erase student work.
    // Videos have no words; synthesis steps clear so a fresh draft assembles.
    const keepAnswer = step.type === 'video' || step.type === 'synthesis' ? '' : (st && st.answer) || '';
    state.steps[k] = {
      status: 'pending', answer: keepAnswer, attempts: 0, thread: [],
      ...(st && st.board ? { board: st.board } : {}),
      ...(st && st.fields ? { fields: st.fields } : {}),
      ...(st && st.xpAwarded ? { xpAwarded: true } : {}),
    };
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
  // Redoing a synthesis step means "assemble me a fresh draft from my current work" —
  // clear the old draft and the once-only flag so the auto-draft fires again.
  if (step.type === 'synthesis') { delete st.autoDrafted; st.answer = ''; }
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

function exportBuilderFile(src, filename) {
  const s = src || state;
  const done = k => !!(s.steps[k] && s.steps[k].status === 'done');
  const mastered = k => !done(k) && !!s.mastery[k];
  const lines = ['# Builders Club — Builder File', '', `_Exported ${new Date().toLocaleString()} · ${s.xp} XP · ${s.streak}-day streak_`, ''];
  for (const ws of WORKSHEETS) {
    const touched = ws.sections.some(sec => sec.steps.some(st => {
      const k = keyOf(sec, st);
      return done(k) || mastered(k);
    }));
    if (!touched) continue;
    lines.push(`# ${ws.title}`, '');
    for (const section of ws.sections) {
    lines.push(`## ${section.num}. ${section.title}`);
    const artifact = s.artifacts[section.id];
    if (artifact) lines.push('', `> **${section.artifactLabel}**`, '>', ...artifact.split('\n').map(l => '> ' + l), '');
    for (const step of section.steps) {
      const k = keyOf(section, step);
      const st = s.steps[k];
      if (mastered(k)) { lines.push(`### ${step.title}`, '', `_Mastered — skipped. ${s.mastery[k].reason}_`, ''); continue; }
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
  a.download = filename || 'my-builder-file.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

function slug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'student';
}

// The roster's ⬇ button: fetch that student's work and write their Builder file
// without disturbing whatever the instructor is currently looking at.
async function downloadStudentFile(oid) {
  const row = (rosterCache || []).find(r => r.oid === oid);
  try {
    const theirs = normalizeState(await (await api(`/api/instructor/students/${encodeURIComponent(oid)}/state`)).json());
    exportBuilderFile(theirs, slug(row && row.name) + '-builder-file.md');
  } catch {
    alert('Couldn\u2019t download that Builder file — check your connection and try again.');
  }
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
  // <details> fires toggle, not click — remember which drawers the student left open.
  document.addEventListener('toggle', e => {
    if (!e.target.closest) return;
    const f = e.target.closest('[data-fold]');
    if (f) setFold(f.dataset.fold, f.open);
    const b = e.target.closest('[data-block]');
    if (b) setBlockClosed(b.dataset.block, !b.open);
  }, true);

  document.addEventListener('click', e => {
    // Reading a student's work: swallow anything that would write to it.
    if (viewingAs && e.target.closest(MUTATING_SEL)) { e.preventDefault(); return; }

    const student = e.target.closest('[data-student]');
    const dl = e.target.closest('[data-dl]');
    if (dl) { e.stopPropagation(); downloadStudentFile(dl.dataset.dl); return; }
    if (student) { location.hash = '#/instructor/' + student.dataset.student; return; }

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
      api('/api/settings', {
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
      api('/api/settings', {
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
    if (exp) {
      // While viewing a student, `state` IS their work — name the file for them.
      exportBuilderFile(state, viewingAs ? slug(viewingAs.name) + '-builder-file.md' : 'my-builder-file.md');
      return;
    }

    const ims = e.target.closest('[data-importmd]');
    if (ims) { const inp = document.getElementById('importFile'); if (inp) inp.click(); return; }

    const shb = e.target.closest('[data-showbackups]');
    if (shb) { showBackupList(); return; }

    const rsb = e.target.closest('[data-restorebackup]');
    if (rsb) {
      const label = (rsb.querySelector('.opt-title') || rsb).textContent.trim();
      restoreBackup(rsb.dataset.restorebackup, label);
      return;
    }

    const lesson = e.target.closest('[data-lesson]');
    if (lesson) {
      const l = document.getElementById('lesson-' + cssId(lesson.dataset.lesson));
      if (l) l.classList.toggle('open');
      lesson.classList.toggle('open');
      return;
    }

    const cp = e.target.closest('[data-copyprompt]');
    if (cp && !cp.disabled) { copyPortablePrompt(cp); return; }

    const cpr = e.target.closest('[data-copypractice]');
    if (cpr && !cpr.disabled) { copyPortablePrompt(cpr, 'practice'); return; }

    const hr = e.target.closest('[data-hardreset]');
    if (hr) {
      if (!confirm('Hard reset: this erases EVERY answer, artifact, XP point, and streak in your account — all worksheets back to brand new. There is no undo.\n\nErase everything?')) return;
      api('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .then(() => { location.hash = '#/'; location.reload(); })
        .catch(() => alert('Couldn’t reset — check your connection and try again.'));
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

    const unm = e.target.closest('[data-unmaster]');
    if (unm) { delete state.mastery[unm.dataset.unmaster]; saveState(true); route(); return; }
  });

  // The hidden file input on the Settings page (upload a Builder file).
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'importFile') importBuilderFile(e.target);
  });

  // Persist drafts as they type — plain answers, list rows, and board cards.
  document.addEventListener('input', e => {
    const ta = e.target.closest('[data-draft]');
    if (ta) { stepState(ta.dataset.draft).answer = ta.value; saveState(); return; }

    const fb = e.target.closest('.answer[data-fieldstep]');
    if (fb) {
      const k = fb.dataset.fieldstep;
      serializeFields(k, findByKey(k).step);
      saveState();
      return;
    }

    const li = e.target.closest('.li-input');
    if (li) {
      // One box = one line of the saved answer, so a pasted newline would split
      // the item in two. Flatten it into a space and let the box grow instead.
      if (li.value.includes('\n')) li.value = li.value.replace(/\s*\n\s*/g, ' ');
      autoGrow(li);
      serializeList(li.dataset.list);
      saveState();
      return;
    }

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

  // Browsers without ResizeObserver fall back to re-fitting on window resize.
  if (!listObserver) {
    let sizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(sizeTimer);
      sizeTimer = setTimeout(sizeListBoxes, 120);
    });
  }

  document.addEventListener('keydown', e => {
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

/* ---------------------------------------------------------------- sign-in views */

/* Signed out. The worksheets themselves say nothing about who you are, so this
   is the whole gate: one button that hands off to Microsoft. */
function renderLogin({ devLogin, microsoft, configured, problem }) {
  document.body.classList.add('anon');
  const note = {
    failed: 'That sign-in didn\u2019t go through. Try again, and tell your instructor if it keeps happening.',
    expired: 'That sign-in took too long and expired. Give it another go.',
    tenant: 'That account isn\u2019t part of the directory this site accepts. Use the account your instructor told you to.',
    domain: 'That account isn\u2019t on your instructor\u2019s list. Sign in with your school address, or ask them to add you.',
    unconfigured: 'Sign-in isn\u2019t set up on this site yet \u2014 your instructor needs to finish configuring it.',
    // A tenant that blocks unapproved apps sends people back without a token.
    consent: 'Your school blocked this app for school accounts. Sign in with a personal Microsoft account instead, or ask your instructor.',
  }[problem || (configured === false ? 'unconfigured' : '')];

  const signInCard = `
    <section class="section is-active">
      <div class="sec-headtext">
        <div class="sec-kicker">SIGN IN</div>
        <h2 class="sec-title">Use your Microsoft account</h2>
      </div>
      <p class="sec-tagline">Your school account, or a personal Microsoft account \u2014 either works. We keep your name, your email, and your worksheet answers, and nothing else.</p>
      <div class="answer-tools">
        <a class="btn" href="/auth/login">Sign in with Microsoft \u25b8</a>
      </div>
    </section>`;

  const nothingCard = `
    <section class="section is-active">
      <div class="sec-headtext">
        <div class="sec-kicker">SIGN IN</div>
        <h2 class="sec-title">Not set up yet</h2>
      </div>
      <p class="sec-tagline">This site doesn\u2019t have a way to sign in configured yet. Your instructor needs to finish setting it up.</p>
    </section>`;

  $('#view').innerHTML = `
    <section class="hero">
      <span class="kicker">Builders Club \u00b7 one semester</span>
      <h1>Your<br>Worksheets</h1>
      <p>Scaffolded worksheets with an AI reviewer built in. Sign in and pick up exactly where you left off \u2014 your answers save themselves as you type.</p>
    </section>
    ${note ? `<section class="section is-active"><p class="sec-tagline login-err">${esc(note)}</p></section>` : ''}
    ${microsoft ? signInCard : nothingCard}
    ${devLogin ? '<div class="answer-tools"><a class="ask-btn" href="/auth/dev" title="Local development only \u2014 add ?as=name for another test student">Dev sign-in</a></div>' : ''}`;
}

/* Something went wrong that reloading might fix. Deliberately does NOT invent an
   empty state: writing that back would erase real work. */
function renderFatal(message) {
  // The header counters would read 0, which is worse than showing nothing.
  document.body.classList.add('anon');
  $('#view').innerHTML = `
    <section class="section is-active">
      <div class="sec-headtext">
        <div class="sec-kicker">HANG ON</div>
        <h2 class="sec-title">Couldn\u2019t load your worksheets</h2>
      </div>
      <p class="sec-tagline">${esc(message)}</p>
      <div class="answer-tools"><button class="btn" onclick="location.reload()">Reload the page</button></div>
    </section>`;
}

function showWho() {
  const who = document.getElementById('who');
  const name = document.getElementById('whoName');
  if (who && me) {
    if (name) { name.textContent = (me.name || me.email || '').split(' ')[0]; name.title = me.name || me.email || ''; }
    who.hidden = false;
  }
  const btn = document.getElementById('instructorBtn');
  if (btn && me && me.role === 'instructor') btn.hidden = false;
}

/* ---------------------------------------------------------------- boot */

// Fill in anything an older or partial state is missing, so every render path
// can assume the same shape. Shared with the instructor's read-only view.
function normalizeState(s) {
  const next = s && typeof s === 'object' ? s : {};
  if (!next.steps) next.steps = {};
  if (!next.artifacts) next.artifacts = {};
  if (!next.mastery) next.mastery = {};
  if (typeof next.xp !== 'number') next.xp = 0;
  if (typeof next.streak !== 'number') next.streak = 0;
  // Migrate pre-flag states: anything already done has already earned its XP.
  for (const st of Object.values(next.steps)) {
    if (st && st.status === 'done' && st.xpAwarded === undefined) st.xpAwarded = true;
  }
  return next;
}

async function fetchMe() {
  const res = await fetch('/api/me', { cache: 'no-store' });
  if (!res.ok) throw new Error('could not reach the server');
  return res.json();
}

async function boot() {
  let who;
  try {
    who = await fetchMe();
  } catch {
    return renderFatal('We couldn\u2019t reach the server. Check your connection and reload.');
  }

  if (!who.authenticated) {
    const problem = new URLSearchParams(location.search).get('auth');
    return renderLogin({
      devLogin: !!who.devLogin,
      microsoft: !!who.microsoft,
      configured: who.configured,
      problem,
    });
  }
  me = who;
  document.body.classList.remove('anon');

  try {
    state = normalizeState(await (await api('/api/state')).json());
  } catch (e) {
    if (e.name === 'AuthError') {
      // The session went away between /api/me and here — ask who we are again
      // so the page offers whichever sign-in methods this site has.
      const again = await fetchMe().catch(() => ({}));
      return renderLogin({ devLogin: !!again.devLogin, microsoft: !!again.microsoft, configured: again.configured });
    }
    return renderFatal('We couldn\u2019t load your work just now. Reload the page \u2014 nothing has been changed.');
  }

  try {
    const s = await (await api('/api/settings')).json();
    appSettings.freeRoam = !!s.freeRoam;
  } catch { /* defaults stand */ }

  // margin gears + header
  const G = window.BuildersGears;
  $('.mg-l1').innerHTML = G.gearSVG({ teeth: 12, color: '#181a1f', fill: '#4886f3', stroke: 2.5, bolts: 5, size: 150 });
  $('.mg-l2').innerHTML = G.gearSVG({ teeth: 9, color: '#181a1f', fill: '#fddf67', stroke: 2.5, bolts: 3, size: 96 });
  $('.mg-r1').innerHTML = G.gearSVG({ teeth: 14, color: '#181a1f', fill: '#ff635e', stroke: 2.5, bolts: 6, size: 180 });
  $('.mg-r2').innerHTML = G.gearSVG({ teeth: 8, color: '#181a1f', fill: '#ffffff', stroke: 2.5, bolts: 0, size: 88 });
  G.initScrollGears();

  wire();
  showWho();
  route();
  // The web fonts land after the first render and change how the text wraps,
  // so measure again once they're in.
  if (document.fonts) document.fonts.ready.then(() => { sizeListBoxes(); sizeRecapBoxes(); });
}

boot();

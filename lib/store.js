'use strict';
/*
  Builders Club — per-student storage.

  One folder per student under DATA_DIR/students/<oid>/:
    state.json     answers, XP, streak, artifacts, mastery, review threads
    settings.json  their engine + progression choices
    profile.json   name, email, first/last seen — what the roster reads
    usage.json     AI calls per UTC day, for the daily cap
    backups/       snapshots of state.json, newest 100

  On Railway this lives on the attached Volume, so it survives redeploys. The
  service must run a single replica: writes are synchronous and last-write-wins
  within one process, which is only safe because there is exactly one.
*/

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(__dirname, '..', 'data');

const STUDENTS_DIR = path.join(DATA_DIR, 'students');

/* Student ids come from Microsoft's `oid` claim, which is always a GUID. Every
   path is built from one, so anything that isn't a GUID never reaches the disk. */
const OID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isOid(oid) { return OID_RE.test(String(oid || '')); }

function assertOid(oid) {
  if (!isOid(oid)) throw new Error('bad student id');
  return String(oid).toLowerCase();
}

function studentDir(oid) {
  const dir = path.join(STUDENTS_DIR, assertOid(oid));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Atomic: a crash mid-write can never leave a half-written file behind.
function writeJSON(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

/* ---------------------------------------------------------------- state */

const DEFAULT_STATE = {
  meta: { version: 1, updatedAt: 0 },
  xp: 0, streak: 0, lastActiveDay: '',
  steps: {}, artifacts: {}, mastery: {},
};

function freshState() { return JSON.parse(JSON.stringify(DEFAULT_STATE)); }

function stateFile(oid) { return path.join(studentDir(oid), 'state.json'); }

function readState(oid) { return readJSON(stateFile(oid), freshState()); }

/* Snapshots of state.json, taken the moment BEFORE any meaningful change lands —
   a step completed, submitted, redone, mastered, or an artifact earned/removed.
   Typing doesn't count, so every snapshot marks a real event and any accident can
   be rolled back to just before it happened. Newest 100 kept. */
function stateSignature(s) {
  const steps = s.steps || {};
  return JSON.stringify([
    Object.keys(steps).sort().map(k => [k, steps[k].status, steps[k].attempts]),
    Object.keys(s.mastery || {}).sort(),
    Object.keys(s.artifacts || {}).sort(),
  ]);
}

function backupDir(oid) { return path.join(studentDir(oid), 'backups'); }

function backupState(oid, next) {
  try {
    const file = stateFile(oid);
    if (!fs.existsSync(file)) return;
    if (stateSignature(readState(oid)) === stateSignature(next)) return; // just typing — not an event
    const dir = backupDir(oid);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, path.join(dir, `state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    const files = fs.readdirSync(dir).filter(f => /^state-.*\.json$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 100))) fs.unlinkSync(path.join(dir, f));
  } catch { /* a failed backup must never block the save itself */ }
}

function writeState(oid, obj) {
  backupState(oid, obj);
  writeJSON(stateFile(oid), obj);
}

const BACKUP_FILE_RE = /^state-[\w-]+\.json$/;

function listBackups(oid) {
  const dir = backupDir(oid);
  try {
    return fs.readdirSync(dir)
      .filter(f => BACKUP_FILE_RE.test(f))
      .sort().reverse().slice(0, 15)
      .map(f => {
        let done = 0, xp = 0;
        const s = readJSON(path.join(dir, f), null);
        if (s) {
          done = Object.values(s.steps || {}).filter(st => st && st.status === 'done').length;
          xp = s.xp || 0;
        }
        return { file: f, ts: fs.statSync(path.join(dir, f)).mtimeMs, done, xp };
      });
  } catch { return []; } // no backups yet
}

// Restoring snapshots the CURRENT state first, so a restore is itself undoable.
function restoreBackup(oid, file) {
  if (!BACKUP_FILE_RE.test(String(file || ''))) return false;
  const src = path.join(backupDir(oid), file);
  if (!fs.existsSync(src)) return false;
  const restored = readJSON(src, null);
  if (!restored) return false;
  writeState(oid, restored);
  return true;
}

function resetState(oid) { writeState(oid, freshState()); }

/* ---------------------------------------------------------------- settings */

function settingsFile(oid) { return path.join(studentDir(oid), 'settings.json'); }
function readSettings(oid) { return readJSON(settingsFile(oid), {}); }
function writeSettings(oid, obj) { writeJSON(settingsFile(oid), obj); }

/* ---------------------------------------------------------------- profile */

function profileFile(oid) { return path.join(studentDir(oid), 'profile.json'); }

// Called on every sign-in: keeps name/email current if the school changes them.
function upsertProfile({ oid, name, email }) {
  const now = Date.now();
  const prev = readJSON(profileFile(oid), null) || {};
  const profile = {
    oid: assertOid(oid),
    name: name || prev.name || email || '',
    email: email || prev.email || '',
    firstSeen: prev.firstSeen || now,
    lastSeen: now,
  };
  writeJSON(profileFile(oid), profile);
  lastTouch.set(profile.oid, now);
  return profile;
}

/* lastSeen drives the roster's "active 5 min ago" column. Students save on every
   keystroke, so rewriting the profile each time would be pure disk churn —
   once every 5 minutes is plenty for a roster. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const lastTouch = new Map();

function touchLastSeen(oid) {
  const key = assertOid(oid);
  const now = Date.now();
  if (now - (lastTouch.get(key) || 0) < TOUCH_INTERVAL_MS) return;
  lastTouch.set(key, now);
  const profile = readJSON(profileFile(key), null);
  if (!profile) return; // no profile until they sign in
  profile.lastSeen = now;
  writeJSON(profileFile(key), profile);
}

/* ---------------------------------------------------------------- usage / daily cap */

function usageFile(oid) { return path.join(studentDir(oid), 'usage.json'); }
function todayKey() { return new Date().toISOString().slice(0, 10); } // UTC day

function readUsage(oid) { return readJSON(usageFile(oid), {}); }

function usageToday(oid) {
  const day = readUsage(oid)[todayKey()] || {};
  return Object.values(day).reduce((n, v) => n + (Number(v) || 0), 0);
}

function bumpUsage(oid, kind) {
  const usage = readUsage(oid);
  const day = todayKey();
  usage[day] = usage[day] || {};
  usage[day][kind] = (usage[day][kind] || 0) + 1;
  // A week of history is enough to answer "did they hit the cap yesterday?"
  const keep = Object.keys(usage).sort().slice(-7);
  const pruned = {};
  for (const k of keep) pruned[k] = usage[k];
  writeJSON(usageFile(oid), pruned);
}

/* ---------------------------------------------------------------- roster */

// One row per student who has ever signed in. A class is a few dozen folders,
// so reading them per request is cheaper than keeping a cache honest.
function listStudents() {
  let dirs = [];
  try { dirs = fs.readdirSync(STUDENTS_DIR).filter(isOid); } catch { return []; }
  return dirs.map(oid => {
    const profile = readJSON(path.join(STUDENTS_DIR, oid, 'profile.json'), null) || {};
    const state = readJSON(path.join(STUDENTS_DIR, oid, 'state.json'), null) || {};
    const steps = state.steps || {};
    return {
      oid,
      name: profile.name || '(unknown)',
      email: profile.email || '',
      firstSeen: profile.firstSeen || 0,
      lastSeen: profile.lastSeen || 0,
      stepsDone: Object.values(steps).filter(st => st && st.status === 'done').length,
      xp: state.xp || 0,
      artifacts: Object.keys(state.artifacts || {}).length,
    };
  }).sort((a, b) => b.lastSeen - a.lastSeen);
}

function studentExists(oid) {
  return isOid(oid) && fs.existsSync(path.join(STUDENTS_DIR, String(oid).toLowerCase()));
}

module.exports = {
  DATA_DIR,
  isOid, assertOid, studentDir,
  DEFAULT_STATE, freshState, readState, writeState, resetState,
  listBackups, restoreBackup,
  readSettings, writeSettings,
  upsertProfile, touchLastSeen,
  usageToday, bumpUsage,
  listStudents, studentExists,
};

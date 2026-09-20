/*
  What the dashboard has loaded, and how it gets it.

  In the version that read downloaded markdown, this file was mostly a fight with
  localStorage: student work had to survive a reload, it was far too big to fit,
  so everything was stripped to a "digest" of numbers and the instructor was
  asked to pick the folder again before they could read anyone's writing.

  None of that is true any more. The server has the work, so a reload is a fetch.
  What stays here is the small part that was always right: the class-wide fetch
  carries numbers only, because the screens it feeds — the grid, the step
  rankings, the leaderboard — do not show a word of anyone's writing. Prose is
  fetched one student or one step at a time, by the screen that will actually
  display it.

  localStorage now holds view preferences and nothing else. If it fails, the
  dashboard still works; you just get the default view next time.
*/
'use strict';

/* eslint-disable no-var */
var store = (function () {
  const PREFS_KEY = 'bcdash.prefs.v1';

  const STATE = {
    loadedAt: 0,
    records: [],           // digest records — numbers, no prose
    roster: { students: [] },
    digestOnly: true,      // true of STATE.records, always; screens that need prose fetch it
    ui: { dash: 'grid', mentor: '', answersort: 'name' },
  };

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      Object.assign(STATE.ui, saved);
    } catch { /* private window, blocked storage — defaults are fine */ }
  }

  function saveUi() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(STATE.ui)); } catch { /* not worth a word to the user */ }
  }

  /* Every student who has signed in is on the roster — there is no separate list
     to keep, and no way to be on it without having an account. That kills the
     whole business of matching files to people, and with it the one mistake in
     the old dashboard that could actually hurt someone: filing one builder's
     work under another's name. */
  function rosterFromRecords(records) {
    return records.map(r => ({
      id: r.rosterId,
      name: r.displayName || '(unnamed)',
      email: r.email || '',
      mentorName: '',
      active: true,
      lastSeen: r.lastSeen || 0,
    }));
  }

  async function load(api) {
    const { students } = await (await api('/api/instructor/class')).json();
    STATE.records = students || [];
    STATE.roster.students = rosterFromRecords(STATE.records);
    STATE.loadedAt = Date.now();
    return STATE.records;
  }

  // One student, with their writing and every review thread.
  const loadRecord = (api, oid) => api(`/api/instructor/record/${encodeURIComponent(oid)}`).then(r => r.json());

  // One step, across the class, with everyone's writing on it.
  const loadStep = (api, key) => {
    const [sectionId, stepId] = String(key).split('/');
    return api(`/api/instructor/step/${encodeURIComponent(sectionId)}/${encodeURIComponent(stepId)}`).then(r => r.json());
  };

  /* The class is a live thing, so a visit that arrives a while after the last
     fetch gets a fresh one. Moving between dashboard screens inside the window
     reuses what's loaded, which is what keeps the grid from re-fetching every
     time you click a cell and come back. */
  const FRESH_MS = 30000;
  const hasData = () => STATE.records.length > 0 && Date.now() - STATE.loadedAt < FRESH_MS;
  const clear = () => { STATE.records = []; STATE.roster.students = []; STATE.loadedAt = 0; };

  loadPrefs();
  return { STATE, saveUi, load, loadRecord, loadStep, hasData, clear };
}());

if (typeof window !== 'undefined') window.store = store;

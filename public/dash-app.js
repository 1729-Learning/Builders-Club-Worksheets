/*
  The dashboard's router, living inside the worksheets app.

  The student app owns #/, #/w/..., #/settings. Everything under #/instructor is
  ours. That split is why this is a separate router rather than more branches in
  app.js: the two halves answer different questions, share only the shell, and
  the instructor half is the one that is allowed to be heavy.

      #/instructor                      the class — grid, board or list
      #/instructor/steps                which step the class is failing
      #/instructor/steps/<sectionId>    one section
      #/instructor/step/<sec>/<step>    one step, every answer to it
      #/instructor/b/<oid>              one builder, everything they wrote
      #/instructor/xp                   the leaderboard
      #/instructor/read/<oid>           hands back to the student app's own
                                        read-only view of their worksheets

  Screens are plain functions returning HTML strings, same as the student app.
  The ones that need a student's writing say so by being routed through a fetch;
  everything else runs on the numbers-only class digest.
*/
'use strict';

/* eslint-disable no-var */
var dashApp = (function () {
  let handlers = [];
  let api = null;         // the student app's fetch wrapper — it owns the 401 banner
  let booted = false;

  const OID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function parse(hash) {
    const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    const rest = parts.slice(1);   // drop 'instructor'
    if (!rest.length) return { name: 'class' };
    if (rest[0] === 'xp') return { name: 'xp' };
    if (rest[0] === 'steps') return { name: 'steps', sel: rest[1] ? { sectionId: rest[1] } : null };
    if (rest[0] === 'step') return { name: 'steps', sel: { stepKey: rest.slice(1).join('/') } };
    if (rest[0] === 'b') return { name: 'builder', id: rest[1] };
    if (rest[0] === 'read') return { name: 'read', id: rest[1] };
    // Bare #/instructor/<oid> is where the read-only view used to live; keep it working.
    if (OID_RE.test(rest[0])) return { name: 'read', id: rest[0] };
    return { name: 'class' };
  }

  const APP = {
    on: (selector, fn) => handlers.push({ selector, fn }),
    render: () => render(),
    route: () => parse(location.hash),
  };

  const shell = inner => `
    <div class="flow-topbar"><a class="crumb" href="#/">◂ Worksheets</a></div>
    <nav class="dash-nav">
      ${[['#/instructor', 'Class'], ['#/instructor/steps', 'Steps'], ['#/instructor/xp', 'XP']]
    .map(([href, label]) => `<a href="${href}" class="${location.hash.replace(/^#/, '') === href.replace(/^#/, '') ? 'on' : ''}">${label}</a>`).join('')}
    </nav>
    <div class="dash">${inner}</div>`;

  const loading = () => shell('<p class="sec-tagline">Loading…</p>');

  function failed(message) {
    return shell(`<div class="banner coral">${ui.esc(message)}</div>
      <p><a class="btn white" href="#/instructor">Back to the class</a></p>`);
  }

  /* Every await below is a chance for the instructor to click something else, so
     the hash is re-checked before anything is written to the page — the same
     guard enterViewingAs uses in the student app. */
  async function render() {
    const view = document.getElementById('view');
    if (!view) return;
    const at = location.hash;
    const stillWanted = () => location.hash === at;
    const r = parse(at);

    view.classList.add('wide', 'dash-page');
    view.innerHTML = loading();
    handlers = [];

    let body;
    try {
      if (!store.hasData()) await store.load(api);
      if (!stillWanted()) return;

      if (r.name === 'xp') {
        body = viewXp.render(APP);
      } else if (r.name === 'builder') {
        const rec = await store.loadRecord(api, r.id);
        if (!stillWanted()) return;
        body = viewBuilder.render(APP, rec);
      } else if (r.name === 'steps') {
        let answers = null;
        if (r.sel && r.sel.stepKey) {
          answers = (await store.loadStep(api, r.sel.stepKey)).entries;
          if (!stillWanted()) return;
        }
        body = viewSteps.render(APP, r.sel, answers);
      } else {
        body = viewClass.render(APP);
      }
    } catch (e) {
      if (e && e.name === 'AuthError') return;   // the student app has already said so
      // A thrown screen should say what broke, not leave a blank page.
      console.error('[dashboard]', e);
      view.innerHTML = failed('Something went wrong building that view: ' + (e && e.message ? e.message : 'unknown error'));
      return;
    }

    if (!stillWanted()) return;
    view.innerHTML = shell(body);
    viewClass.wire(APP);
    viewSteps.wire(APP);
    viewBuilder.wire(APP);
    viewXp.wire(APP);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  /* One listener for the whole dashboard, registered once. The student app has
     its own on document; neither matches the other's data-* names, and both fall
     through harmlessly when nothing matches. */
  function boot(deps) {
    api = deps.api;
    if (booted) return;
    booted = true;
    document.addEventListener('click', e => {
      if (!location.hash.startsWith('#/instructor')) return;
      for (const h of handlers) {
        const el = e.target.closest(h.selector);
        if (el) { e.preventDefault(); h.fn(el, e); return; }
      }
    });
  }

  // The roster changes as students work, so a fresh visit refetches.
  const invalidate = () => store.clear();

  return { boot, render, parse, invalidate };
}());

if (typeof window !== 'undefined') window.dashApp = dashApp;

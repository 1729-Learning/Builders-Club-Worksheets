/* Recent worksheet visits, not time-on-task or a browsing history. No heartbeat:
   an idle foreground tab must go quiet just like a background tab. */
'use strict';

var WorksheetActivity = (function () {
  const INTERVAL_MS = 5 * 60 * 1000;

  function start({ send, eligible, doc = document, win = window, now = Date.now }) {
    let lastAttempt = null;
    let pending = false;
    let stopped = false;
    const listeners = [];

    function visit(event) {
      // Script-dispatched events are not evidence of a visit.
      if (event && !event.isTrusted) return;
      // Capturing window focus also sees programmatic focus on form fields.
      if (event && event.type === 'focus' && event.target !== win) return;
      if (stopped || pending || doc.visibilityState !== 'visible' || !doc.hasFocus() || !eligible()) return;
      const time = now();
      if (lastAttempt !== null && time - lastAttempt < INTERVAL_MS) return;
      lastAttempt = time;
      pending = true;
      // No event details, page/step ids, text, or client timestamp leave the tab.
      Promise.resolve().then(send).catch(() => {
        // Best effort. Retry on a later real visit/interaction, never in a loop.
      }).finally(() => { pending = false; });
    }

    function listen(target, type) {
      target.addEventListener(type, visit, { passive: true, capture: true });
      listeners.push([target, type]);
    }
    for (const type of ['visibilitychange', 'pointerdown', 'keydown', 'wheel', 'touchstart']) listen(doc, type);
    for (const type of ['focus', 'pageshow']) listen(win, type);
    visit(); // already-authenticated readers need not edit or sign in again

    return () => {
      stopped = true;
      for (const [target, type] of listeners) target.removeEventListener(type, visit, true);
    };
  }

  return { start, INTERVAL_MS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WorksheetActivity;

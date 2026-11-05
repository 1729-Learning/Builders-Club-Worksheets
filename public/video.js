/*
  Gated YouTube segment player.
  Honest seams: this enforces a linear watch-through of [start,end] INSIDE the embed
  (anti-scrub + accumulated-watch-time check). It cannot stop someone muting the tab
  or watching the same video on youtube.com directly — by design, we shape the path,
  we don't prison-guard it.

  Blocked networks: school filters often block YouTube outright, or let the page
  load but not the video stream. The gate reports that through onBlocked(reason)
  so the app can offer a way past the step instead of stranding the student:
    'api'      — the iframe API script failed to load (youtube.com blocked)
    'timeout'  — the player never became ready (embed replaced by a filter page)
    'error:N'  — the player raised YouTube error N (unavailable / not embeddable)
    'stalled'  — it started buffering and never got to playing
*/
'use strict';

const VideoGate = (() => {
  let apiPromise = null;

  const READY_TIMEOUT_MS = 15000; // no onReady by then → the embed isn't coming
  const STALL_TIMEOUT_MS = 15000; // buffering this long without playing → stream blocked

  function loadAPI() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      const tag = document.createElement('script');
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (window.onYouTubeIframeAPIReady === onReady) window.onYouTubeIframeAPIReady = prev;
        if (error) { apiPromise = null; tag.remove(); reject(error); }
        else resolve(window.YT);
      };
      const onReady = () => { finish(); if (prev) prev(); };
      window.onYouTubeIframeAPIReady = onReady;
      // A silently filtered script must not leave a cached pending promise
      // forever: a later Redo on a working network needs a fresh attempt.
      const timer = setTimeout(() => finish(new Error('timeout')), READY_TIMEOUT_MS);
      tag.src = 'https://www.youtube.com/iframe_api';
      // A blocked script never fires onYouTubeIframeAPIReady. Forget the promise
      // so a later mount (e.g. after the network changes) tries again.
      tag.onerror = () => finish(new Error('api'));
      document.head.appendChild(tag);
    });
    return apiPromise;
  }

  /*
    create({ el, youtubeId, start, end, resumeAt, watchedSeconds, onProgress, onComplete, onPlaying, onBlocked })
    - el: container element (will host the iframe)
    - resumeAt: persisted maxWatched to resume from
    - onProgress({maxWatched, watchedSeconds, pct}) fires ~2x/sec while playing
    - onComplete() fires once when the segment is genuinely finished
    - onPlaying() fires each time playback actually starts
    - onBlocked(reason) fires once per failure, rearmed if playback recovers
    Returns { destroy() }.
  */
  function create(opts) {
    const { el, youtubeId, start, end } = opts;
    const span = end - start;
    let maxWatched = Math.max(start, Math.min(opts.resumeAt || start, end));
    let watchedSeconds = opts.watchedSeconds || 0;
    let player = null;
    let poller = null;
    let lastTick = null;
    let completed = false;
    let destroyed = false;
    let ready = false;
    let blocked = false;
    let readyTimer = null;
    let stallTimer = null;

    function clearStall() { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } }
    function reportBlocked(reason) {
      if (blocked || destroyed || completed) return;
      blocked = true;
      clearTimeout(readyTimer);
      clearStall();
      if (opts.onBlocked) opts.onBlocked(reason);
    }

    function stopPoll() { if (poller) { clearInterval(poller); poller = null; } lastTick = null; }

    function tick() {
      if (!player || completed || destroyed) return;
      let t;
      try { t = player.getCurrentTime(); } catch { return; }
      const now = Date.now();

      // Anti-scrub: jumping >2s past the furthest point watched snaps back.
      if (t > maxWatched + 2) {
        player.seekTo(maxWatched, true);
        lastTick = now;
        return;
      }
      // Accumulate real watch time (clamped so speed tricks don't inflate it).
      if (lastTick !== null) {
        let rate = 1;
        try { rate = player.getPlaybackRate() || 1; } catch { /* ignore */ }
        if (rate > 2) { try { player.setPlaybackRate(2); } catch { /* ignore */ } rate = 2; }
        watchedSeconds += Math.min((now - lastTick) / 1000 * rate, 2);
      }
      lastTick = now;
      if (t > maxWatched) maxWatched = Math.min(t, end);

      const pct = Math.max(0, Math.min(1, (maxWatched - start) / span));
      if (opts.onProgress) opts.onProgress({ maxWatched, watchedSeconds, pct });

      // Done = reached the end AND actually watched ~90% of the span.
      if (t >= end - 0.75 && watchedSeconds >= span * 0.9) {
        completed = true;
        stopPoll();
        try { player.pauseVideo(); } catch { /* ignore */ }
        if (opts.onComplete) opts.onComplete();
      } else if (t >= end - 0.25) {
        // Reached the boundary without enough accumulated time (scrub tricks) — hold at end.
        try { player.pauseVideo(); } catch { /* ignore */ }
      }
    }

    // Covers both a script that hangs (no error, no load) and a player that is
    // created but never reports ready because a filter replaced the embed.
    readyTimer = setTimeout(() => { if (!ready) reportBlocked('timeout'); }, READY_TIMEOUT_MS);

    loadAPI().then(YT => {
      if (destroyed) return;
      player = new YT.Player(el, {
        videoId: youtubeId,
        playerVars: {
          start: Math.floor(maxWatched), end: Math.ceil(end),
          controls: 1, rel: 0, disablekb: 1, fs: 1, modestbranding: 1, playsinline: 1,
        },
        events: {
          onReady() { if (destroyed) return; ready = true; clearTimeout(readyTimer); },
          onError(e) { reportBlocked('error:' + e.data); },
          onStateChange(e) {
            if (destroyed || completed) return;
            if (e.data === YT.PlayerState.BUFFERING) {
              if (!stallTimer) stallTimer = setTimeout(() => reportBlocked('stalled'), STALL_TIMEOUT_MS);
            } else {
              clearStall();
            }
            if (e.data === YT.PlayerState.PLAYING) {
              blocked = false; // a later stall after recovery needs its own offer
              lastTick = Date.now();
              if (!poller) poller = setInterval(tick, 500);
              if (opts.onPlaying) opts.onPlaying();
            } else {
              tick();
              stopPoll();
            }
          },
        },
      });
    }).catch(error => reportBlocked(error.message === 'timeout' ? 'timeout' : 'api'));

    return {
      destroy() {
        destroyed = true;
        clearTimeout(readyTimer);
        clearStall();
        stopPoll();
        if (player && player.destroy) try { player.destroy(); } catch { /* ignore */ }
      },
    };
  }

  return { create };
})();

window.VideoGate = VideoGate;

/*
  Gated YouTube segment player.
  Honest seams: this enforces a linear watch-through of [start,end] INSIDE the embed
  (anti-scrub + accumulated-watch-time check). It cannot stop someone muting the tab
  or watching the same video on youtube.com directly — by design, we shape the path,
  we don't prison-guard it.
*/
'use strict';

const VideoGate = (() => {
  let apiPromise = null;

  function loadAPI() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(resolve => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
    return apiPromise;
  }

  /*
    create({ el, youtubeId, start, end, resumeAt, watchedSeconds, onProgress, onComplete })
    - el: container element (will host the iframe)
    - resumeAt: persisted maxWatched to resume from
    - onProgress({maxWatched, watchedSeconds, pct}) fires ~2x/sec while playing
    - onComplete() fires once when the segment is genuinely finished
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

    function stopPoll() { if (poller) { clearInterval(poller); poller = null; } lastTick = null; }

    function tick() {
      if (!player || completed) return;
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

    loadAPI().then(YT => {
      if (destroyed) return;
      player = new YT.Player(el, {
        videoId: youtubeId,
        playerVars: {
          start: Math.floor(maxWatched), end: Math.ceil(end),
          controls: 1, rel: 0, disablekb: 1, fs: 1, modestbranding: 1, playsinline: 1,
        },
        events: {
          onStateChange(e) {
            if (e.data === YT.PlayerState.PLAYING) {
              lastTick = Date.now();
              if (!poller) poller = setInterval(tick, 500);
            } else {
              tick();
              stopPoll();
            }
          },
        },
      });
    });

    return {
      destroy() {
        destroyed = true;
        stopPoll();
        if (player && player.destroy) try { player.destroy(); } catch { /* ignore */ }
      },
    };
  }

  return { create };
})();

window.VideoGate = VideoGate;

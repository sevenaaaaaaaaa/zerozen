(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u) return;
  const host = location.hostname;
  if (!/(^|\.)youtube\.com$/.test(host) && !/(^|\.)youtube-nocookie\.com$/.test(host)) return;
  if (!u.isTop()) return;

  const SKIP_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-slot button",
    ".ytp-ad-survey-answer-button",
  ];

  let wasMuted = null;
  let pendingSkips = 0;
  let timer = null;
  let enabled = true;

  function player() {
    return document.querySelector("#movie_player");
  }

  function trySkipButton() {
    for (const sel of SKIP_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        try {
          btn.click();
          return true;
        } catch (e) {}
      }
    }
    return false;
  }

  function fastForward(video) {
    try {
      if (isFinite(video.duration) && video.duration > 0) {
        if (video.duration - video.currentTime > 0.4) video.currentTime = video.duration;
      } else if (video.currentTime < 90) {
        video.currentTime = 90;
      }
    } catch (e) {}
  }

  function dismissEnforcement() {
    const dialog = document.querySelector("ytd-enforcement-message-view-model");
    if (dialog) {
      const wrapper = dialog.closest("tp-yt-paper-dialog") || dialog;
      try {
        wrapper.remove();
      } catch (e) {}
    }
    const err = document.querySelector("yt-playability-error-supported-renderers");
    if (err && /ad block/i.test(err.textContent || "")) {
      try {
        err.remove();
      } catch (e) {}
    }
  }

  function tick() {
    if (!enabled) return;
    const p = player();
    if (!p) return;
    const adShowing = p.classList.contains("ad-showing") || p.classList.contains("ad-interrupting");
    if (adShowing) {
      const video = p.querySelector("video");
      if (video) {
        if (wasMuted === null) wasMuted = video.muted;
        video.muted = true;
        fastForward(video);
      }
      trySkipButton();
      pendingSkips++;
      dismissEnforcement();
      return;
    }
    if (wasMuted !== null) {
      const video = p.querySelector("video");
      if (video) video.muted = wasMuted;
      wasMuted = null;
      if (pendingSkips) {
        ZZ.send({ type: "zz:stats", payload: { texts: 1 } });
        pendingSkips = 0;
      }
    }
    dismissEnforcement();
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, 350);
  }

  ZZ.YouTube = {
    init() {
      start();
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          if (timer) clearInterval(timer);
          timer = null;
        } else start();
      });
      ZZ.send({ type: "zz:report", payload: { module: "youtube", active: true } });
    },
    disable() {
      enabled = false;
    },
  };
})();

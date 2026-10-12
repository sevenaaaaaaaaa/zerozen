// <video>/<audio> 直链扫描：播放器直接用 mp4 地址（非 blob/MSE）时，补充进嗅探列表
(function () {
  const ZZ = globalThis.ZZ;
  if (!ZZ || !ZZ.u) return;
  const seen = new Set();

  function scan() {
    let nodes = [];
    try {
      nodes = document.querySelectorAll("video, audio, video source, audio source");
    } catch (e) {
      return;
    }
    for (const el of nodes) {
      const src = el.currentSrc || el.src || el.getAttribute("src") || "";
      if (!/^https?:/i.test(src) || seen.has(src)) continue;
      seen.add(src);
      const kind = /\.m3u8(\?|#|$)/i.test(src) ? "m3u8" : el.tagName === "AUDIO" || (el.parentElement && el.parentElement.tagName === "AUDIO") ? "audio" : "media";
      ZZ.send({ type: "zz:sniff:page", payload: { url: src, kind } });
    }
  }

  function start() {
    scan();
    document.addEventListener("loadedmetadata", (e) => {
      if (e.target && /^(VIDEO|AUDIO)$/.test(e.target.tagName)) scan();
    }, true);
    let n = 0;
    const timer = setInterval(() => {
      scan();
      if (++n > 10) clearInterval(timer);
    }, 3000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

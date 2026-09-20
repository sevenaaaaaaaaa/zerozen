(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u) return;
  const api = ZZ.browser;

  const settingsHint = { countMatches: true };

  function collect(opts) {
    const deep = !!(opts && opts.deep);
    const res = ZZ.Detector.collect({
      threshold: deep ? 18 : 24,
      cap: deep ? 60 : 30,
    });
    return res;
  }

  function init() {
    ZZ.Css.init();
    ZZ.Guard.init();
    if (ZZ.YouTube) ZZ.YouTube.init();
    if (ZZ.Picker) ZZ.Picker.init();
    ZZ.logEnabled = false;

    const notifyReady = () => {
      ZZ.send({
        type: "zz:page-ready",
        payload: { url: u.url(), title: u.title(), top: u.isTop() },
      });
    };
    if (document.readyState === "complete") {
      setTimeout(notifyReady, 700);
    } else {
      window.addEventListener("load", () => setTimeout(notifyReady, 700), { once: true });
      document.addEventListener(
        "DOMContentLoaded",
        () => setTimeout(notifyReady, 1800),
        { once: true }
      );
    }
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    switch (msg.type) {
      case "zz:rules-updated": {
        ZZ.bus.emit("rules-updated");
        if (msg.payload && msg.payload.reason === "antiadblock" && u.isTop()) {
          ZZ.notice("ZeroZen：检测到反广告拦截，已自动切换为兼容档");
        }
        sendResponse({ ok: true });
        return false;
      }
      case "zz:site-disabled": {
        ZZ.bus.emit("site-disabled");
        if (msg.payload && msg.payload.reason === "antiadblock" && u.isTop()) {
          const minutes = msg.payload.until ? Math.max(1, Math.round((msg.payload.until - Date.now()) / 60000)) : 30;
          ZZ.notice("ZeroZen：本站反拦截较强，已临时放行 " + minutes + " 分钟");
        }
        sendResponse({ ok: true });
        return false;
      }
      case "zz:notice": {
        if (u.isTop()) ZZ.notice((msg.payload && msg.payload.text) || "");
        sendResponse({ ok: true });
        return false;
      }
      case "zz:ai:highlight": {
        const payload = msg.payload || {};
        if (!u.isTop()) {
          sendResponse({ ok: false, error: "not top frame" });
          return false;
        }
        const res = ZZ.Detector.highlight(payload.selectors, payload);
        sendResponse(res);
        return false;
      }
      case "zz:ai:highlight-done": {
        sendResponse({ ok: true });
        return false;
      }
      case "zz:scan:collect": {
        if (!u.isTop()) {
          sendResponse({ ok: false, error: "not top frame" });
          return false;
        }
        try {
          const res = collect(msg.payload);
          sendResponse(res);
        } catch (e) {
          sendResponse({ ok: false, error: (e && e.message) || "collect failed" });
        }
        return false;
      }
      case "zz:picker:start": {
        if (!u.isTop()) {
          sendResponse({ ok: false, error: "not top frame" });
          return false;
        }
        ZZ.Picker.start();
        sendResponse({ ok: true });
        return false;
      }
    }
    return false;
  });

  if (u.isTop()) init();
  else {
    ZZ.Css.init();
    ZZ.Guard.init();
  }
})();

(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u) return;

  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let injected = false;
  let popups = 0;
  let toastTimer = null;

  function toast(text) {
    let el = document.querySelector(".zz-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "zz-toast";
      el.setAttribute("data-zz-ui", "1");
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = text;
    el.classList.add("zz-toast-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("zz-toast-visible");
    }, 2600);
  }

  function injectGuard() {
    if (injected) return;
    const root = document.documentElement || document.head || document;
    if (!root || !root.appendChild) return;
    const el = document.createElement("script");
    el.src = ZZ.browser.runtime.getURL("content/inject-guard.js");
    el.setAttribute("data-zz-token", token);
    el.async = false;
    el.onload = () => el.remove();
    try {
      root.appendChild(el);
      injected = true;
    } catch (e) {
      ZZ.log("guard inject failed", e);
    }
  }

  function pushConfig(enabled, notifications) {
    try {
      window.postMessage(
        { __zz: "guard-config", token, enabled: enabled !== false, notifications: notifications !== false },
        "*"
      );
    } catch (e) {}
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__zz !== "popup-blocked" || data.token !== token) return;
    popups++;
    ZZ.Css.reportPopup(1);
    if (popups <= 3) {
      toast("ZeroZen 已拦截弹窗" + (popups > 1 ? "（本页 " + popups + " 次）" : ""));
    }
  });

  ZZ.Guard = {
    init() {
      injectGuard();
      ZZ.bus.on("guard-config", (cfg) => pushConfig(cfg.enabled, cfg.notifications));
      ZZ.bus.on("site-disabled", () => pushConfig(false, false));
    },
    popups() {
      return popups;
    },
    configure(enabled, notifications) {
      pushConfig(enabled, notifications);
    },
  };
})();

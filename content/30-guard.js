(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u) return;

  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let injected = false;
  let popups = 0;
  let lastBlocked = null;
  let bar = null;
  let barTimer = null;

  const REASONS = {
    "ad-host": "目标是广告联盟",
    popunder: "点击空白处弹出的站外窗口",
    "double-open": "一次点击打开了多个窗口",
    "no-gesture": "页面在无操作时自动弹出",
    clickjack: "透明点击劫持层",
  };

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return "";
    }
  }

  // 拦截提示条：说明拦了什么、为什么，并给出「打开一次 / 本站总是允许」——误拦当场可纠正
  function showBar(info) {
    if (!u.isTop()) return;
    const root = document.body || document.documentElement;
    if (!root) return;
    if (!bar || !bar.isConnected) {
      bar = document.createElement("div");
      bar.setAttribute("data-zz-ui", "1");
      bar.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);";
      const sr = bar.attachShadow({ mode: "open" });
      sr.innerHTML =
        "<style>" +
        ".b{display:flex;align-items:center;gap:10px;max-width:min(560px,92vw);padding:9px 10px 9px 14px;border-radius:12px;background:rgba(15,23,42,.96);color:#f8fafc;" +
        "font:13px/1.4 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);animation:in .18s ease}" +
        "@keyframes in{from{opacity:0;transform:translateY(8px)}}" +
        ".t{flex:1;min-width:0}.t b{font-weight:600}.s{display:block;color:#94a3b8;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        "button{all:unset;cursor:pointer;padding:5px 10px;border-radius:8px;font-size:12px;white-space:nowrap;background:rgba(255,255,255,.1)}" +
        "button:hover{background:rgba(255,255,255,.2)}button.p{background:#3b82f6}button.p:hover{background:#2563eb}button.x{padding:5px 8px;background:none;color:#94a3b8}" +
        "</style><div class='b'><span class='t'><b></b><span class='s'></span></span>" +
        "<button class='once'></button><button class='p always'></button><button class='x'>×</button></div>";
      sr.querySelector(".once").textContent = ZZ.T("打开一次");
      sr.querySelector(".always").textContent = ZZ.T("本站允许弹窗");
      sr.querySelector(".once").addEventListener("click", () => {
        const url = lastBlocked && lastBlocked.url;
        hideBar();
        // 先放行再打开：内容脚本的点击是真实用户手势，浏览器会允许
        if (url) {
          pushConfig(false, false);
          try {
            window.open(url, "_blank", "noopener");
          } catch (e) {}
          setTimeout(() => pushConfig(guardCfg.enabled, guardCfg.notifications), 300);
        }
      });
      sr.querySelector(".always").addEventListener("click", async () => {
        hideBar();
        guardCfg.enabled = false;
        pushConfig(false, false);
        await ZZ.send({ type: "zz:site:popups", payload: { host: u.host(), allow: true } });
        toast(ZZ.T("已允许本站弹出新窗口（可在弹窗面板撤销）"));
      });
      sr.querySelector(".x").addEventListener("click", hideBar);
      root.appendChild(bar);
    }
    const sr = bar.shadowRoot;
    sr.querySelector("b").textContent =
      ZZ.T("已拦截弹窗") + (popups > 1 ? ZZ.T("（本页 $1 次）", popups) : "") + " · " + ZZ.T(REASONS[info.reason] || "可疑弹窗");
    sr.querySelector(".s").textContent = info.url ? hostOf(info.url) || info.url : ZZ.T("通知权限请求");
    sr.querySelector(".once").style.display = info.url ? "" : "none";
    if (barTimer) clearTimeout(barTimer);
    barTimer = setTimeout(hideBar, 7000);
  }

  function hideBar() {
    if (barTimer) clearTimeout(barTimer);
    barTimer = null;
    if (bar) bar.remove();
    bar = null;
  }

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
    setTimeout(() => el.classList.remove("zz-toast-visible"), 2600);
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

  const guardCfg = { enabled: true, notifications: true };
  // 页面主世界的守卫脚本可能比配置消息晚就绪：它装好监听后会发 guard-ready，这里补发一次
  let cfgKnown = false;

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
    if (!data || data.token !== token) return;
    if (data.__zz === "guard-ready") {
      // 配置还没到就先按「关闭」处理：后台页误关窗口的代价比漏拦一次大
      pushConfig(cfgKnown ? guardCfg.enabled : false, cfgKnown ? guardCfg.notifications : false);
      return;
    }
    if (data.__zz === "media-found") {
      ZZ.send({ type: "zz:sniff:page", payload: { url: data.url, type: data.type || "" } });
      return;
    }
    if (data.__zz !== "popup-blocked") return;
    popups++;
    lastBlocked = { url: data.url || "", reason: data.reason || "", kind: data.kind || "" };
    ZZ.Css.reportPopup(1);
    ZZ.send({ type: "zz:popup:log", payload: { host: u.host(), url: lastBlocked.url, reason: lastBlocked.reason } }).catch?.(() => {});
    // 子框架里的拦截交给顶层展示（子框架太小放不下提示条）
    if (u.isTop()) showBar(lastBlocked);
  });

  ZZ.Guard = {
    init() {
      injectGuard();
      ZZ.bus.on("guard-config", (cfg) => {
        cfgKnown = true;
        guardCfg.enabled = cfg.enabled !== false;
        guardCfg.notifications = cfg.notifications !== false;
        pushConfig(guardCfg.enabled, guardCfg.notifications);
      });
      ZZ.bus.on("site-disabled", () => {
        cfgKnown = true;
        pushConfig(false, false);
      });
    },
    popups() {
      return popups;
    },
    lastBlocked() {
      return lastBlocked;
    },
    configure(enabled, notifications) {
      cfgKnown = true;
      guardCfg.enabled = enabled !== false;
      guardCfg.notifications = notifications !== false;
      pushConfig(enabled, notifications);
    },
  };
})();

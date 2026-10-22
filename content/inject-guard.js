// 页面主世界弹窗守卫：只拦「不是用户想打开」的新窗口。
// 判定依据（按优先级）：
//   1. 目标是已知广告联盟域名 → 一律拦
//   2. 同源 / about:blank / 已知登录与支付域名 → 近期有真实用户操作就放行（OAuth、支付常在 fetch 之后异步打开）
//   3. 跨站新窗口 → 必须由「可交互元素」（链接/按钮/表单控件/role=button…）触发；
//      点在空白处/正文/视频上却弹出跨站窗口 = popunder，拦
//   4. 同一次点击打开第二个跨站窗口 → 拦（「一次点击开两个页」）
//   5. 完全没有用户操作的 window.open → 拦
(function () {
  if (window.__zzGuardInstalled) return;
  window.__zzGuardInstalled = true;

  const script = document.currentScript;
  const token = (script && script.dataset && script.dataset.zzToken) || "";

  const state = {
    enabled: true,
    notifications: true,
    // 配置到达前只拦「明确的广告联盟域名」：站点可能是投放后台，误关窗口的代价比漏拦一次高
    configured: false,
  };

  const AD_HOST_RE =
    /(^|\.)(magsrv|pemsrv|wpadmngr|exoclick|exosrv|realsrv|exdynsrv|juicyads|juicycdn|trafficjunky|tsyndicate|trafficstars|popads|popcash|propellerads|propellerpops|onclasrv|onclickads|clickadu|adcash|adsterra|adskeeper|hilltopads|adspyglass|traffichunt|zeropark|plugrush|twinrdsrv|twinrdengine|trafficfactory|galaksion|clickaine|ad-maven|admaven|richpush|pushhouse|monetag|highperformanceformat|profitablecpmrate|stripchat|chaturbate)\./;

  // 登录 / 授权 / 支付：业务上必须弹新窗口，常在网络请求之后异步打开
  const AUTH_HOST_RE =
    /(^|\.)(accounts\.google\.com|appleid\.apple\.com|login\.microsoftonline\.com|login\.live\.com|github\.com|gitlab\.com|facebook\.com|twitter\.com|x\.com|api\.twitter\.com|discord\.com|slack\.com|linkedin\.com|open\.weixin\.qq\.com|graph\.qq\.com|xui\.ptlogin2\.qq\.com|api\.weibo\.com|passport\.[a-z0-9-]+\.[a-z.]+|auth0\.com|okta\.com|paypal\.com|checkout\.stripe\.com|js\.stripe\.com|alipay\.com|mclient\.alipay\.com|pay\.weixin\.qq\.com|openapi\.alipay\.com|unionpay\.com)$/;

  const INTERACTIVE_SEL =
    "a[href],button,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[onclick],[contenteditable=''],[contenteditable=true]";

  // 最近一次真实用户操作
  const last = { t: 0, target: null, interactive: false, opens: 0, crossOpens: 0 };

  function report(kind, url, reason) {
    try {
      window.postMessage(
        { __zz: "popup-blocked", token, kind, reason: reason || "", url: String(url || "").slice(0, 500) },
        "*"
      );
    } catch (e) {}
  }

  function userActive() {
    try {
      if (navigator.userActivation) return navigator.userActivation.isActive === true;
    } catch (e) {}
    return Date.now() - last.t < 1000;
  }

  function hostOf(url) {
    try {
      return new URL(String(url), location.href).hostname.toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function siteOf(host) {
    const parts = String(host || "").split(".").filter(Boolean);
    if (parts.length <= 2) return parts.join(".");
    // 粗略 eTLD+1：处理 com.cn / co.uk 这类二级后缀
    const sl = parts[parts.length - 2];
    if (/^(com|net|org|gov|edu|co|ac)$/.test(sl) && parts[parts.length - 1].length === 2) return parts.slice(-3).join(".");
    return parts.slice(-2).join(".");
  }

  function isAdUrl(url) {
    if (!url) return false;
    const href = String(url);
    if (/^(javascript:|about:|blob:|data:)/i.test(href)) return false;
    const host = hostOf(href);
    if (!host || host === location.hostname) return false;
    return AD_HOST_RE.test(host);
  }

  // 覆盖整屏的透明链接/层：看起来是「可点击元素」，实际是点击劫持
  function isClickjackLayer(el) {
    try {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      if ((r.width * r.height) / (vw * vh) < 0.45) return false;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "absolute") return false;
      const bg = cs.backgroundColor;
      const transparent = bg === "transparent" || bg === "rgba(0, 0, 0, 0)" || parseFloat(cs.opacity || "1") < 0.2;
      return transparent && !(el.textContent || "").trim();
    } catch (e) {
      return false;
    }
  }

  function interactiveTarget(target) {
    if (!target || !target.closest) return false;
    const hit = target.closest(INTERACTIVE_SEL);
    if (hit) return !isClickjackLayer(hit);
    try {
      // 自绘按钮：没有语义标签，但光标是手型
      let n = target;
      for (let i = 0; i < 3 && n && n.nodeType === 1; i++) {
        if (getComputedStyle(n).cursor === "pointer") return !isClickjackLayer(n);
        n = n.parentElement;
      }
    } catch (e) {}
    return false;
  }

  function onUser(event) {
    if (!event.isTrusted) return;
    // 同一次手势（pointerdown → mousedown → click）只算一次，避免 opens 计数被重置
    const now = Date.now();
    if (now - last.t > 400 || event.type === "pointerdown" || event.type === "keydown") {
      last.opens = 0;
      last.crossOpens = 0;
    }
    last.t = now;
    const target = event.composedPath ? event.composedPath()[0] : event.target;
    last.target = target && target.nodeType === 1 ? target : target && target.parentElement;
    last.interactive = event.type === "keydown" ? true : interactiveTarget(last.target);
  }

  for (const type of ["pointerdown", "mousedown", "click", "keydown", "touchend"]) {
    try {
      window.addEventListener(type, onUser, true);
    } catch (e) {}
  }

  // 返回 null = 放行；否则返回拦截原因
  function judgeOpen(url) {
    const href = url === undefined || url === null ? "" : String(url);
    if (isAdUrl(href)) return "ad-host";
    if (!state.configured) return null;
    const since = Date.now() - last.t;
    const gesture = userActive() || since < 1200;
    const blank = !href || /^about:blank/i.test(href);
    const host = blank ? location.hostname : hostOf(href);
    const sameSite = !host || siteOf(host) === siteOf(location.hostname);
    if (blank || sameSite) {
      return gesture || since < 6000 ? null : "no-gesture";
    }
    if (AUTH_HOST_RE.test(host)) {
      return since < 15000 ? null : "no-gesture";
    }
    if (!gesture) return "no-gesture";
    if (!last.interactive) return "popunder";
    if (last.crossOpens >= 1) return "double-open";
    return null;
  }

  const origOpen = window.open;
  if (typeof origOpen === "function") {
    window.open = function (url, name, features) {
      if (state.enabled) {
        const reason = judgeOpen(url);
        if (reason) {
          report("open", url ? new URL(String(url), location.href).href : "", reason);
          return null;
        }
        last.opens++;
        const h = hostOf(url || "");
        if (h && siteOf(h) !== siteOf(location.hostname)) last.crossOpens++;
      }
      return origOpen.apply(this, arguments);
    };
    try {
      Object.defineProperty(window.open, "toString", { value: () => "function open() { [native code] }" });
    } catch (e) {}
  }

  if (window.Notification && window.Notification.requestPermission) {
    const origPermission = window.Notification.requestPermission.bind(window.Notification);
    try {
      window.Notification.requestPermission = function (callback) {
        if (state.enabled && state.configured && state.notifications && !userActive()) {
          report("notification", "", "no-gesture");
          if (typeof callback === "function") callback("denied");
          return Promise.resolve("denied");
        }
        return origPermission(callback);
      };
    } catch (e) {}
  }

  // 程序化 a.click() 打开新窗口（popunder 常用手法：造一个游离的 <a target=_blank> 再 click）
  if (window.HTMLAnchorElement && HTMLAnchorElement.prototype.click) {
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (state.enabled && this.href) {
        const blankTarget = /^_blank$/i.test(this.target || "") || (this.target && !/^_(self|top|parent)$/i.test(this.target));
        if (isAdUrl(this.href)) {
          report("link", this.href, "ad-host");
          return;
        }
        if (blankTarget && !(last.target && (last.target === this || (this.contains && this.contains(last.target))))) {
          const reason = judgeOpen(this.href);
          if (reason) {
            report("link", this.href, reason);
            return;
          }
        }
      }
      return origClick.apply(this, arguments);
    };
  }

  try {
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__zz !== "guard-config" || data.token !== token) return;
      state.configured = true;
      state.enabled = data.enabled !== false;
      if (typeof data.notifications === "boolean") state.notifications = data.notifications;
    });
    // 真实点击广告联盟链接（含整屏透明劫持链接）
    document.addEventListener(
      "click",
      (event) => {
        if (!state.enabled || !event.isTrusted) return;
        const a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
        if (!a) return;
        const ad = isAdUrl(a.href);
        const jack = !ad && isClickjackLayer(a) && siteOf(hostOf(a.href)) !== siteOf(location.hostname);
        if (!ad && !jack) return;
        event.preventDefault();
        event.stopPropagation();
        report("link", a.href, ad ? "ad-host" : "clickjack");
      },
      true
    );
  } catch (e) {}

  // 告诉内容脚本「监听已就绪」，让它补发一次配置（首次配置可能比脚本更早到）
  try {
    window.postMessage({ __zz: "guard-ready", token }, "*");
  } catch (e) {}

  window.__zzGuardState = state;
})();

// 媒体嗅探钩子（页面主世界）：播放器用 fetch / XHR 拉取播放列表时上报地址。
// 不读取响应内容，只看地址与 Content-Type；无需 webRequest 权限，也能抓到不带 .m3u8 后缀的接口式播放列表。
(function () {
  if (window.__zzMediaHook) return;
  window.__zzMediaHook = true;
  const script = document.currentScript;
  const token = (script && script.dataset && script.dataset.zzToken) || "";
  const seen = new Set();
  const URL_RE = /\.(m3u8|mpd)(\?|#|$)/i;
  const TYPE_RE = /mpegurl|dash\+xml/i;

  function report(url, type) {
    try {
      const abs = new URL(String(url), location.href).href;
      if (!/^https?:/i.test(abs) || seen.has(abs)) return;
      seen.add(abs);
      if (seen.size > 300) seen.clear();
      window.postMessage({ __zz: "media-found", token, url: abs, type: type || "" }, "*");
    } catch (e) {}
  }

  function check(url, ctype) {
    if (!url) return;
    if (URL_RE.test(url)) report(url, ctype);
    else if (ctype && TYPE_RE.test(ctype)) report(url, ctype);
  }

  // 只在页面真的出现音视频元素后才挂钩：播放器必须先有 <video>/<audio> 才能拉流，
  // 而管理后台、数据看板、文档页永远没有它们，没必要改写这些页面的 fetch
  // （改写会把我们自己的栈帧混进页面自己的错误上报里，例如 Sentry 的 Failed to parse URL）
  let hooked = false;
  function hookNetwork() {
    if (hooked) return;
    hooked = true;
    window.__zzMediaHooked = true;

    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
      const wrapped = function (input) {
        const p = origFetch.apply(this, arguments);
        try {
          if (p && typeof p.then === "function") {
            p.then(
              (res) => {
                try {
                  const url = (res && res.url) || (typeof input === "string" ? input : input && input.url) || "";
                  check(url, res && res.headers && res.headers.get("content-type"));
                } catch (e) {}
              },
              () => {}
            );
          }
        } catch (e) {}
        return p;
      };
      try {
        Object.defineProperty(wrapped, "toString", { value: () => "function fetch() { [native code] }" });
      } catch (e) {}
      window.fetch = wrapped;
    }

    const XHR = window.XMLHttpRequest && XMLHttpRequest.prototype;
    if (XHR && XHR.open) {
      const origOpen = XHR.open;
      XHR.open = function (method, url) {
        try {
          this.__zzUrl = url;
          if (!this.__zzHooked) {
            this.__zzHooked = true;
            this.addEventListener("load", () => {
              try {
                check(this.responseURL || this.__zzUrl, this.getResponseHeader("content-type"));
              } catch (e) {}
            });
          }
        } catch (e) {}
        return origOpen.apply(this, arguments);
      };
    }
  }

  function hasMedia() {
    try {
      return !!(document.querySelector("video,audio"));
    } catch (e) {
      return false;
    }
  }

  if (hasMedia()) hookNetwork();
  else {
    try {
      // 只看新增的子树里有没有媒体元素，避免无媒体页面每次 DOM 变化都做一次全文档查询
      const mo = new MutationObserver((records) => {
        for (const rec of records) {
          for (const node of rec.addedNodes) {
            if (!node || node.nodeType !== 1) continue;
            const tag = node.tagName;
            if (tag === "VIDEO" || tag === "AUDIO" || (node.querySelector && node.querySelector("video,audio"))) {
              mo.disconnect();
              hookNetwork();
              return;
            }
          }
        }
      });
      mo.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}
  }
})();

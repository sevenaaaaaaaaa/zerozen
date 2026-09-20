(function () {
  const g = globalThis;
  const ZZ = (g.ZZ = g.ZZ || {});

  const isFirefox =
    typeof browser !== "undefined" &&
    !!browser.runtime &&
    typeof browser.runtime.getBrowserInfo === "function";
  const api = isFirefox ? browser : chrome;
  ZZ.browser = api;

  ZZ.call = function (target, method, ...args) {
    const fn = target && target[method];
    if (!fn) return Promise.resolve(undefined);
    try {
      const ret = fn.call(target, ...args);
      if (ret && typeof ret.then === "function") return ret;
      return Promise.resolve(ret);
    } catch (err) {
      return Promise.reject(err);
    }
  };

  ZZ.info = {
    chrome: typeof chrome !== "undefined" && !!chrome.runtime,
    firefox: isFirefox,
    safari: /^((?!chrome|android).)*safari/i.test(
      (typeof navigator !== "undefined" && navigator.userAgent) || ""
    ),
    version:
      (api.runtime && api.runtime.getManifest && api.runtime.getManifest().version) || "0.0.0",
  };

  // i18n/i18n.js 会覆盖它；这里留一个回落，保证没加载词典时也能取到中文原文
  ZZ.T = function (text, ...subs) {
    const out = String(text == null ? "" : text);
    return out.replace(/\$(\d+)/g, (m, i) => {
      const v = subs[Number(i) - 1];
      return v === undefined || v === null ? "" : String(v);
    });
  };

  ZZ.log = function (...args) {
    if (ZZ.logEnabled) console.log("[ZeroZen]", ...args);
  };
  ZZ.warn = function (...args) {
    console.warn("[ZeroZen]", ...args);
  };

  ZZ.sleep = function (ms) {
    return new Promise((r) => setTimeout(r, ms));
  };

  ZZ.now = function () {
    return Date.now();
  };

  ZZ.uid = function (prefix) {
    return (
      (prefix || "id") +
      "_" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8)
    );
  };

  ZZ.count = function (obj) {
    if (obj instanceof Map || obj instanceof Set) return obj.size;
    return Array.isArray(obj) ? obj.length : 0;
  };

  ZZ.sendToTab = async function (tabId, message, opts) {
    if (typeof tabId !== "number" || !api.tabs || !api.tabs.sendMessage) return null;
    const base = Object.assign({}, opts || {});
    const target = Object.assign({}, base);
    if (target.frameId === undefined) target.frameId = 0;
    try {
      return await api.tabs.sendMessage(tabId, message, target);
    } catch (e) {
      if (base.frameId === undefined) {
        try {
          return await api.tabs.sendMessage(tabId, message, base);
        } catch (e2) {}
      }
      return null;
    }
  };

  ZZ.reply = function (data) {
    return data === undefined ? { ok: true } : data;
  };

  ZZ.hostOf = function (url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    } catch (e) {
      return "";
    }
  };

  ZZ.isHttpUrl = function (url) {
    return /^https?:\/\//i.test(String(url || ""));
  };

  ZZ.debounce = function (fn, ms) {
    let t = null;
    return function (...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn.apply(this, args);
      }, ms);
    };
  };

  ZZ.chunk = function (arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  ZZ.uniq = function (arr) {
    return Array.from(new Set(arr));
  };

  ZZ.escapeHtml = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  };
})();

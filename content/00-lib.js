(function () {
  const g = globalThis;
  if (g.ZZ && g.ZZ.u) return;
  const ZZ = (g.ZZ = g.ZZ || {});
  const api = typeof browser !== "undefined" && browser.runtime ? browser : chrome;
  ZZ.browser = api;

  const bus = new Map();

  const u = {
    isTop() {
      try {
        return window.top === window;
      } catch (e) {
        return false;
      }
    },

    host() {
      try {
        return location.hostname.toLowerCase();
      } catch (e) {
        return "";
      }
    },

    url() {
      try {
        return location.href;
      } catch (e) {
        return "";
      }
    },

    title() {
      try {
        return document.title || "";
      } catch (e) {
        return "";
      }
    },

    cssEscape(value) {
      const s = String(value || "");
      if (g.CSS && CSS.escape) return CSS.escape(s);
      return s.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
    },

    isValidSelector(selector, doc) {
      try {
        (doc || document).querySelector(selector);
        return true;
      } catch (e) {
        return false;
      }
    },

    matchCount(selector, cap, doc) {
      try {
        const list = (doc || document).querySelectorAll(selector);
        return Math.min(list.length, cap || 100000);
      } catch (e) {
        return -1;
      }
    },

    stableClasses(el) {
      const raw = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
      const out = [];
      for (const cls of raw.split(/\s+/)) {
        if (!cls) continue;
        if (cls.length > 40) continue;
        if (/^[a-z0-9_-]*\d{4,}[a-z0-9_-]*$/i.test(cls)) continue;
        if (/^(ng|css|jsx|sc|emotion|Mui|chakra|v-|svelte|astro|tw-)/i.test(cls)) continue;
        if (/^[a-f0-9]{8,}$/i.test(cls)) continue;
        if (/^_/.test(cls)) continue;
        if (out.length >= 6) break;
        out.push(cls);
      }
      return out;
    },

    selectorPart(el) {
      const tag = el.tagName.toLowerCase();
      const classes = u.stableClasses(el).slice(0, 4);
      let part = tag;
      if (classes.length) part += "." + classes.map(u.cssEscape).join(".");
      const parent = el.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
        const twins = sameTag.filter((c) => u.stableClasses(c).slice(0, 4).join(".") === classes.join("."));
        if (twins.length > 1) part += ":nth-of-type(" + (sameTag.indexOf(el) + 1) + ")";
      }
      return part;
    },

    uniqueSelector(el, doc) {
      if (!el || el.nodeType !== 1) return "";
      const owner = doc || el.ownerDocument || document;
      try {
        if (el.getRootNode() !== owner) return "";
      } catch (e) {
        return "";
      }
      if (el.id && /^[a-zA-Z][\w:-]*$/.test(el.id)) {
        const sel = "#" + u.cssEscape(el.id);
        if (u.matchCount(sel, 3, owner) === 1) return sel;
      }
      let sel = "";
      let cur = el;
      let depth = 0;
      while (cur && cur.nodeType === 1 && depth < 12) {
        const part = u.selectorPart(cur);
        sel = sel ? part + " > " + sel : part;
        const count = u.matchCount(sel, 4, owner);
        if (count === 1) return sel;
        if (cur === owner.body || cur === owner.documentElement) break;
        cur = cur.parentElement;
        depth++;
      }
      return sel;
    },

    genericSelector(el, doc) {
      if (!el || el.nodeType !== 1) return "";
      const owner = doc || el.ownerDocument || document;
      const tag = el.tagName.toLowerCase();
      const classes = u.stableClasses(el).slice(0, 3);
      if (!classes.length) return "";
      const sel = tag + "." + classes.map(u.cssEscape).join(".");
      const count = u.matchCount(sel, 500, owner);
      if (count < 1 || count > 200) return "";
      try {
        if (!el.matches(sel)) return "";
      } catch (e) {
        return "";
      }
      return sel;
    },

    rectOf(el) {
      try {
        const r = el.getBoundingClientRect();
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          x: Math.round(r.x),
          y: Math.round(r.y),
        };
      } catch (e) {
        return { w: 0, h: 0, x: 0, y: 0 };
      }
    },

    styleOf(el) {
      if (!el.ownerDocument || !el.ownerDocument.defaultView) return null;
      try {
        return el.ownerDocument.defaultView.getComputedStyle(el);
      } catch (e) {
        return null;
      }
    },

    textOf(el, max) {
      let text = "";
      try {
        text = el.textContent || "";
      } catch (e) {
        return "";
      }
      text = text.replace(/\s+/g, " ").trim();
      return text.slice(0, max || 140);
    },

    attrsOf(el, limit, baseUrl) {
      const out = {};
      let n = 0;
      const base = baseUrl || (typeof location !== "undefined" ? location.href : "");
      for (const attr of Array.from(el.attributes || [])) {
        const name = attr.name;
        if (name === "class" || name === "style" || name === "id") continue;
        if (!/^(data-|aria-|role$|title$|alt$|href$|target$|rel$)/i.test(name)) continue;
        let value = attr.value;
        if (name === "href" || name === "src") {
          try {
            value = new URL(value, base).hostname;
          } catch (e) {
            value = value.slice(0, 60);
          }
        }
        out[name] = String(value).slice(0, 60);
        if (++n >= (limit || 6)) break;
      }
      return out;
    },

    inExtensionUi(el) {
      try {
        return !!(el.closest && el.closest("[data-zz-ui]"));
      } catch (e) {
        return false;
      }
    },

    isHidden(el) {
      if (!el || el.nodeType !== 1) return true;
      const style = u.styleOf(el);
      if (style) {
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return true;
      }
      return false;
    },

    debounce(fn, ms) {
      let t = null;
      return function (...args) {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          t = null;
          fn.apply(this, args);
        }, ms);
      };
    },

    idle(fn, timeout) {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(fn, { timeout: timeout || 1500 });
      } else {
        setTimeout(fn, 32);
      }
    },

    once(fn) {
      let done = false;
      return function (...args) {
        if (done) return;
        done = true;
        return fn.apply(this, args);
      };
    },
  };

  ZZ.u = u;

  ZZ.bus = {
    on(type, fn) {
      if (!bus.has(type)) bus.set(type, new Set());
      bus.get(type).add(fn);
    },
    emit(type, payload) {
      const set = bus.get(type);
      if (!set) return;
      for (const fn of set) {
        try {
          fn(payload);
        } catch (e) {
          console.warn("[ZeroZen] bus error", type, e);
        }
      }
    },
  };

  ZZ.log = function (...args) {
    if (ZZ.logEnabled) console.log("[ZeroZen]", ...args);
  };

  ZZ.send = function (message) {
    return new Promise((resolve) => {
      let ret;
      try {
        ret = api.runtime.sendMessage(message);
      } catch (e) {
        resolve(null);
        return;
      }
      if (ret && typeof ret.then === "function") {
        ret.then((res) => resolve(res === undefined ? null : res)).catch(() => resolve(null));
      } else {
        resolve(null);
      }
    });
  };

  ZZ.notice = function (text, opts) {
    if (!text) return;
    try {
      let el = document.querySelector(".zz-toast");
      if (!el) {
        el = document.createElement("div");
        el.className = "zz-toast";
        el.setAttribute("data-zz-ui", "1");
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = text;
      el.classList.add("zz-toast-visible");
      const ms = (opts && opts.ms) || 3200;
      clearTimeout(el.__zzTimer);
      el.__zzTimer = setTimeout(() => el.classList.remove("zz-toast-visible"), ms);
    } catch (e) {}
  };
})();

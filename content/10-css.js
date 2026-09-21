(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u) return;

  const TEXT_CANDIDATE_SELECTOR =
    "a, button, [role=button], .btn, [class*=btn], [class*=down], [class*=download], [class*=dload], input[type=button], input[type=submit]";

  const state = {
    version: -1,
    enabled: true,
    profile: "standard",
    hide: [],
    remove: [],
    texts: [],
    textRules: true,
    textRemove: false,
    unlockScroll: false,
    counted: 0,
    removed: 0,
    textsHidden: 0,
    popups: 0,
    flowFix: true,
    observer: null,
    running: false,
    startedAt: 0,
  };

  let reportTimer = null;
  let mutationTimer = null;
  let passCost = 0;

  function report(delta) {
    if (!delta) return;
    state.pending = state.pending || { cosmetic: 0, removed: 0, texts: 0, popups: 0 };
    for (const key of Object.keys(delta)) {
      state.pending[key] = (state.pending[key] || 0) + (delta[key] || 0);
    }
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = null;
      const payload = state.pending;
      state.pending = null;
      if (!payload) return;
      const total =
        (payload.cosmetic || 0) + (payload.removed || 0) + (payload.texts || 0) + (payload.popups || 0);
      if (!total) return;
      ZZ.send({ type: "zz:stats", payload });
    }, 2000);
  }

  function countHidden() {
    if (!state.hide.length) return;
    const chunks = [];
    for (let i = 0; i < state.hide.length; i += 25) chunks.push(state.hide.slice(i, i + 25));
    let total = 0;
    const t0 = performance.now();
    for (const chunk of chunks) {
      const selector = chunk.join(",");
      try {
        total += document.querySelectorAll(selector).length;
      } catch (e) {
        for (const sel of chunk) {
          try {
            total += document.querySelectorAll(sel).length;
          } catch (e2) {}
        }
      }
    }
    passCost = performance.now() - t0;
    if (total > state.counted) {
      const delta = total - state.counted;
      state.counted = total;
      report({ cosmetic: delta });
    }
  }

  function applyRemovals() {
    if (!state.remove.length) return;
    let removed = 0;
    for (const sel of state.remove) {
      if (removed > 400) break;
      let nodes = [];
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (const node of nodes) {
        if (removed > 400) break;
        if (node.hasAttribute && node.hasAttribute("data-zz-ui")) continue;
        try {
          node.remove();
          removed++;
        } catch (e) {}
      }
    }
    if (removed) {
      state.removed += removed;
      report({ removed });
    }
  }

  function applyTextRules() {
    if (!state.texts.length) return;
    let nodes;
    try {
      nodes = document.querySelectorAll(TEXT_CANDIDATE_SELECTOR);
    } catch (e) {
      return;
    }
    const limit = Math.min(nodes.length, 2500);
    let hidden = 0;
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      if (el.hasAttribute && el.hasAttribute("data-zz-ui")) continue;
      const text = u.textOf(el, 30).toLowerCase();
      if (!text) continue;
      for (const rule of state.texts) {
        if (rule.tag && el.tagName.toLowerCase() !== rule.tag) continue;
        if (!text.includes(String(rule.text).toLowerCase())) continue;
        let alreadyHidden = false;
        try {
          const style = window.getComputedStyle(el);
          alreadyHidden = style.display === "none" || style.visibility === "hidden";
        } catch (e) {}
        if (alreadyHidden) break;
        try {
          if (state.textRemove || rule.action === "remove") el.remove();
          else el.style.setProperty("display", "none", "important");
          hidden++;
        } catch (e) {}
        break;
      }
      if (hidden >= 200) break;
    }
    if (hidden) {
      state.textsHidden += hidden;
      report({ texts: hidden });
    }
  }

  function unlockScroll() {
    if (!state.unlockScroll) return;
    try {
      const html = document.documentElement;
      const body = document.body;
      if (html && /hidden/i.test(html.style.overflow)) html.style.setProperty("overflow", "auto", "important");
      if (body && /hidden/i.test(body.style.overflow)) body.style.setProperty("overflow", "auto", "important");
      if (html && /fixed/i.test(html.style.position) && html.style.top) {
        html.style.removeProperty("position");
        html.style.removeProperty("top");
      }
    } catch (e) {}
  }

  const PLAYER_HINT = /(player|plyr|video-js|jwplayer|dplayer|artplayer|html5-video|fp-player|vjs-|mediaelement)/i;
  const AD_HOST_RE =
    /magsrv|pemsrv|wpadmngr|exoclick|exosrv|realsrv|exdynsrv|juicyads|juicycdn|trafficjunky|tsyndicate|trafficstars|popads|popcash|propeller|onclasrv|clickadu|adcash|adsterra|adskeeper|hilltopads|adspyglass|traffichunt|zeropark|plugrush|twinrd|trafficfactory|galaksion|clickaine|ad-maven/i;
  const AD_NAME_RE = /(^|[^a-z0-9])(ad|ads|adv|sponsor|popunder|popup|interstitial|exo|juicy|tsad|ts_ad|overlay)([^a-z0-9]|$)/i;

  function isPlayerish(el) {
    if (!el || !el.closest) return false;
    if (el.closest("video, audio, [data-zz-ui]")) return true;
    let n = el;
    for (let i = 0; i < 5 && n && n !== document.documentElement; i++) {
      const idc = String((n.id || "") + " " + (n.className || ""));
      if (PLAYER_HINT.test(idc)) return true;
      n = n.parentElement;
    }
    return false;
  }

  function sweepOverlays() {
    const root = document.body;
    if (!root || document.fullscreenElement) return 0;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    let killed = 0;
    let nodes;
    try {
      nodes = root.querySelectorAll("div,section,aside,iframe,a");
    } catch (e) {
      return 0;
    }
    const limit = Math.min(nodes.length, 700);
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      if (el.getAttribute && (el.getAttribute("data-zz-ui") || el.getAttribute("data-zz-overlay"))) continue;
      if (isPlayerish(el)) continue;
      let cs;
      try {
        cs = window.getComputedStyle(el);
      } catch (e) {
        continue;
      }
      if (!cs || cs.display === "none" || cs.visibility === "hidden") continue;
      if (cs.position !== "fixed" && cs.position !== "absolute") continue;
      const z = parseInt(cs.zIndex, 10);
      if (!(z >= 50)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 60) continue;
      const cover = (r.width * r.height) / (vw * vh);
      const fullish = cover >= 0.32 || (r.width >= vw * 0.82 && r.height >= vh * 0.32);
      const stickyBar =
        cs.position === "fixed" && (r.bottom >= vh - 10 || r.top <= 10) && r.height <= 160 && r.width >= vw * 0.55;
      const idc = String((el.id || "") + " " + (typeof el.className === "string" ? el.className : ""));
      const adName = AD_NAME_RE.test(idc);
      let iframe = null;
      try {
        iframe = el.tagName === "IFRAME" ? el : el.querySelector("iframe");
      } catch (e) {}
      const src = iframe ? iframe.src || iframe.getAttribute("src") || "" : "";
      const iframeAd = !!(iframe && (AD_HOST_RE.test(src) || /ads?|banner|pop/i.test(src)));
      const emptyFull = fullish && el.childElementCount === 0 && (cs.cursor === "pointer" || z >= 9999);
      const clickjack = fullish && z >= 100 && (parseFloat(cs.opacity || "1") < 0.2 || cs.backgroundColor === "transparent" || cs.backgroundColor === "rgba(0, 0, 0, 0)");
      if (!(iframeAd || (fullish && (adName || iframe)) || emptyFull || clickjack || (stickyBar && (adName || iframe)))) continue;
      try {
        el.style.setProperty("display", "none", "important");
        el.setAttribute("data-zz-overlay", "1");
        killed++;
      } catch (e) {}
      if (killed >= 16) break;
    }
    if (killed) {
      try {
        document.documentElement.style.setProperty("overflow", "auto", "important");
        if (document.body) document.body.style.setProperty("overflow", "auto", "important");
      } catch (e) {}
      report({ popups: killed });
    }
    return killed;
  }

  function runPass() {
    if (!state.enabled || state.running) return;
    state.running = true;
    const t0 = performance.now();
    try {
      countHidden();
      applyRemovals();
      applyTextRules();
      sweepOverlays();
      unlockScroll();
    } catch (e) {
      ZZ.log("pass error", e);
    }
    state.running = false;
    const cost = performance.now() - t0;
    if (cost > 150) passCost = cost;
  }

  const schedulePass = u.debounce(runPass, 400);

  function startObserver() {
    if (state.observer) return;
      if (!state.enabled) return;
    state.observer = new MutationObserver((records) => {
      let meaningful = false;
      for (const rec of records) {
        if (rec.addedNodes && rec.addedNodes.length) {
          for (const node of rec.addedNodes) {
            if (node.nodeType === 1) {
              meaningful = true;
              break;
            }
          }
        }
        if (meaningful) break;
      }
      if (!meaningful) return;
      const delay = passCost > 150 ? 2000 : 600;
      if (mutationTimer) clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        runPass();
      }, delay);
    });
    try {
      state.observer.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}
  }

  function stopObserver() {
    if (state.observer) {
      try {
        state.observer.disconnect();
      } catch (e) {}
      state.observer = null;
    }
    if (mutationTimer) {
      clearTimeout(mutationTimer);
      mutationTimer = null;
    }
  }

  function applyPayload(payload) {
    const p = payload || {};
    if (!p.enabled) {
      state.enabled = false;
      state.hide = [];
      state.remove = [];
      state.texts = [];
      state.flowFix = false;
      stopObserver();
      return;
    }
    state.enabled = true;
    state.version = p.version;
    state.profile = p.profile || "standard";
    state.flowFix = p.flowFix !== false;
    state.hide = Array.isArray(p.hide) ? p.hide : [];
    state.remove = Array.isArray(p.remove) ? p.remove : [];
    state.textRules = p.textRules !== false;
    state.textRemove = !!p.textRemove;
    state.texts = state.textRules && Array.isArray(p.texts) ? p.texts : [];
    state.unlockScroll = !!p.unlockScroll;
    state.counted = 0;
    if (p.guard) ZZ.bus.emit("guard-config", p.guard);
    if (p.youtube === false && ZZ.YouTube) ZZ.YouTube.disable();
    startObserver();
    u.idle(runPass);
  }

  async function requestRules() {
    const res = await ZZ.send({ type: "zz:get-rules", payload: { host: u.host() } });
    if (!res) return null;
    if (res.lang && ZZ.I18n) ZZ.I18n.setLang(res.lang);
    applyPayload(res);
    return res;
  }

  ZZ.Css = {
    state,
    applyPayload,
    requestRules,
    runPass,
    reportPopup(n) {
      report({ popups: n || 1 });
    },
    init() {
      state.startedAt = Date.now();
      ZZ.bus.on("rules-updated", () => requestRules());
      ZZ.bus.on("site-disabled", () => applyPayload({ enabled: false }));
      requestRules();
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && state.enabled) schedulePass();
      });
      setTimeout(() => {
        if (state.enabled) schedulePass();
      }, 1500);
    },
  };
})();

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
    undoExempt: [],
    counted: 0,
    removed: 0,
    textsHidden: 0,
    popups: 0,
    flowFix: true,
    observer: null,
    running: false,
    startedAt: 0,
  };

  // 用户「恢复」过的误拦元素：豁免选择器命中的不碰
  function isUndone(el) {
    if (!state.undoExempt.length || !el || !el.closest) return false;
    try {
      return el.closest(state.undoExempt.join(",")) !== null;
    } catch (e) {
      return false;
    }
  }

  let reportTimer = null;
  let mutationTimer = null;
  let passCost = 0;

  function report(delta) {
    if (!delta) return;
    state.pending = state.pending || { cosmetic: 0, removed: 0, texts: 0, popups: 0, hits: null };
    for (const key of Object.keys(delta)) {
      if (key === "hits") {
        const cur = state.pending.hits || {};
        for (const [sel, n] of Object.entries(delta.hits || {})) {
          if (typeof n === "number" && n > 0) cur[sel] = (cur[sel] || 0) + n;
        }
        state.pending.hits = cur;
        continue;
      }
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
    const hits = {};
    const t0 = performance.now();
    for (const chunk of chunks) {
      const selector = chunk.join(",");
      let chunkTotal = 0;
      try {
        chunkTotal = document.querySelectorAll(selector).length;
      } catch (e) {
        for (const sel of chunk) {
          try {
            chunkTotal += document.querySelectorAll(sel).length;
          } catch (e2) {}
        }
      }
      if (chunkTotal > 0 && chunk.length > 1) {
        for (const sel of chunk) {
          let n = 0;
          try {
            n = document.querySelectorAll(sel).length;
          } catch (e3) {}
          if (n) {
            hits[sel] = n;
            if (ZZ.Undo) {
              try {
                document.querySelectorAll(sel).forEach((el, i) => {
                  if (i < 2 && !isUndone(el)) ZZ.Undo.record(el, { kind: "css", sel });
                });
              } catch (e4) {}
            }
          }
        }
      } else if (chunkTotal > 0 && chunk.length === 1) {
        hits[chunk[0]] = chunkTotal;
        if (ZZ.Undo) {
          try {
            document.querySelectorAll(chunk[0]).forEach((el, i) => {
              if (i < 2 && !isUndone(el)) ZZ.Undo.record(el, { kind: "css", sel: chunk[0] });
            });
          } catch (e5) {}
        }
      }
      total += chunkTotal;
    }
    passCost = performance.now() - t0;
    if (total > state.counted) {
      const delta = total - state.counted;
      state.counted = total;
      const keys = Object.keys(hits);
      const top = {};
      for (const sel of Object.keys(hits)
        .sort((a, b) => hits[b] - hits[a])
        .slice(0, 40)) top[sel] = hits[sel];
      report({ cosmetic: delta, hits: top });
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
      if (isUndone(el)) continue;
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
          if (ZZ.Undo) ZZ.Undo.record(el, { kind: "text" });
          if (state.textRemove || rule.action === "remove") el.remove();
          else softHide(el);
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

  // 柔和隐藏：先淡出再 display:none（display 无法过渡），弹层消失不再生硬闪烁
  function softHide(el) {
    try {
      el.style.setProperty("opacity", "0", "important");
      el.style.setProperty("transition", "opacity .16s ease", "important");
      setTimeout(() => {
        try {
          el.style.setProperty("display", "none", "important");
        } catch (e) {}
      }, 170);
    } catch (e) {
      try {
        el.style.setProperty("display", "none", "important");
      } catch (e2) {}
    }
  }

  const waitTimers = { t: null };

  function sweepOverlays() {
    const root = document.body;
    if (!root || document.fullscreenElement || !ZZ.Overlay) return 0;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    let killed = 0;
    let fullKilled = 0;
    let needRecheck = false;
    let nodes;
    try {
      nodes = root.querySelectorAll("div,section,aside,iframe,a,ins");
    } catch (e) {
      return 0;
    }
    const limit = Math.min(nodes.length, 900);
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      if (el.getAttribute && (el.getAttribute("data-zz-ui") || el.getAttribute("data-zz-overlay"))) continue;
      if (isUndone(el)) continue;
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
      if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
      const cover = (r.width * r.height) / (vw * vh);
      const geo = {
        pos: cs.position,
        z,
        fullish: cover >= 0.32 || (r.width >= vw * 0.82 && r.height >= vh * 0.32),
        stickyBar: cs.position === "fixed" && (r.bottom >= vh - 10 || r.top <= 10) && r.height <= 160 && r.width >= vw * 0.55,
        corner: cs.position === "fixed" && r.width <= vw * 0.45 && r.height <= vh * 0.5 && (r.right >= vw - 60 || r.left <= 60) && (r.bottom >= vh - 220 || r.top <= 160),
      };
      const verdict = ZZ.Overlay.judge(el, cs, geo);
      if (verdict.verdict === "wait") {
        needRecheck = true;
        continue;
      }
      if (verdict.verdict !== "ad") continue;
      try {
        if (ZZ.Undo) ZZ.Undo.record(el, { kind: "sweep", why: verdict.reasons.join(",") });
        softHide(el);
        el.setAttribute("data-zz-overlay", verdict.reasons.join(",") || "1");
        killed++;
        if (geo.fullish) fullKilled++;
      } catch (e) {}
      if (killed >= 16) break;
    }
    if (needRecheck && !waitTimers.t) {
      waitTimers.t = setTimeout(() => {
        waitTimers.t = null;
        schedulePass();
      }, 900);
    }
    if (killed) {
      // 只有整屏层被处理时才恢复滚动：页面常因广告遮罩锁住 body 滚动
      if (fullKilled) {
        try {
          document.documentElement.style.setProperty("overflow", "auto", "important");
          if (document.body) document.body.style.setProperty("overflow", "auto", "important");
        } catch (e) {}
      }
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
        // 预渲染隐藏、靠切换 class/style 显示的弹层也要复查
        if (rec.type === "attributes") {
          const t = rec.target;
          if (t && t.nodeType === 1 && !(t.hasAttribute && t.hasAttribute("data-zz-ui")) && t !== document.documentElement && t !== document.body) {
            meaningful = true;
            break;
          }
          continue;
        }
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
      // 节流而非防抖：持续动画/轮播不断触发变更时，防抖会让扫描永远推迟
      if (mutationTimer) return;
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        runPass();
      }, delay);
    });
    try {
      state.observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "open"],
      });
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
    state.undoExempt = Array.isArray(p.undoExempt) ? p.undoExempt : [];
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

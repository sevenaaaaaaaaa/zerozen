// 瀑布流补全：清除信息流（网格/瀑布流布局）里被拦截广告留下的空位。
// 只删除占着位置但没有内容的节点：网络拦截后的空壳广告块、visibility/opacity 幽灵块。
// 有真实内容（文字/已加载图片/已加载 iframe）的节点一律不动，避免误杀懒加载。
(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u) return;

  const MIN_ITEMS = 5; // 容器至少的重复子项数
  const MIN_ITEM_W = 80;
  const MIN_ITEM_H = 60;
  const MAX_FEEDS = 60;
  const MAX_REMOVE = 60;
  const SCAN_CAP = 3000;

  // 站点特配：直接指定信息流容器的子项选择器（通用检测的补充）
  const SITE_FIXES = {
    "jable.tv": [".videos-rows > *"],
  };

  const state = { observer: null, timer: null, running: false, passCost: 0, removed: 0 };

  function report(n) {
    if (!n) return;
    state.removed += n;
    ZZ.send({ type: "zz:stats", payload: { removed: n } }).catch(() => {});
  }

  // 可见性分类：true=可见 / "ghost"=占位但不可见 / false=display:none（不占位）。
  // ghost 只认 visibility:hidden（明确占位隐藏）；opacity 极低的元素可能是入场动画或懒加载中，不碰
  function visibilityKind(el) {
    let cs;
    try {
      cs = window.getComputedStyle(el);
    } catch (e) {
      return false;
    }
    if (!cs || cs.display === "none") return false;
    if (cs.visibility === "hidden") return "ghost";
    return true;
  }

  // iframe 是否真正加载了远程内容：被网络规则拦截的 iframe 停留在空 about:blank；
  // 跨域已加载的 iframe 访问 contentDocument 会抛错（视为有内容）
  function iframeHasContent(iframe) {
    const src = iframe.getAttribute("src") || "";
    if (!src || /^(about|data|javascript|blob):/i.test(src)) {
      try {
        const doc = iframe.contentDocument;
        if (doc) return !!(doc.body && (doc.body.childElementCount > 0 || (doc.body.textContent || "").trim()));
      } catch (e) {
        return true;
      }
      return false;
    }
    try {
      const doc = iframe.contentDocument;
      if (doc === null) return true;
      return !!(doc.body && (doc.body.childElementCount > 0 || (doc.body.textContent || "").trim()));
    } catch (e) {
      return true;
    }
  }

  function hasRealContent(el) {
    if (el.hasAttribute && el.hasAttribute("data-zz-ui")) return true;
    try {
      if ((el.textContent || "").trim()) return true;
    } catch (e) {}
    let nodes = [];
    try {
      nodes = el.querySelectorAll("img,video,audio,canvas,svg,iframe,object,embed,input,textarea,select,button");
    } catch (e) {}
    for (const n of nodes) {
      const tag = n.tagName;
      if (tag === "IMG") {
        if (n.naturalWidth > 0) return true;
      } else if (tag === "VIDEO") {
        if (n.videoWidth > 0 || n.querySelector("source")) return true;
      } else if (tag === "IFRAME") {
        if (iframeHasContent(n)) return true;
      } else {
        return true;
      }
    }
    return false;
  }

  function childSignature(el) {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    return el.tagName + "|" + cls;
  }

  // 通用瀑布流容器识别：子项数量多且形态重复（同标签+同首类名），样本尺寸达到卡片级
  function isFeedContainer(el) {
    const kids = el.children;
    const n = kids.length;
    if (n < MIN_ITEMS) return false;
    const sig = new Map();
    for (let i = 0; i < n; i++) {
      const s = childSignature(kids[i]);
      sig.set(s, (sig.get(s) || 0) + 1);
    }
    let topSig = "";
    let topCount = 0;
    for (const [s, c] of sig) {
      if (c > topCount) {
        topCount = c;
        topSig = s;
      }
    }
    if (topCount < MIN_ITEMS || topCount < Math.ceil(n * 0.5)) return false;
    // 样本尺寸：连续三个同签名子项的可见尺寸中位数达标才算卡片流
    let sampled = 0;
    let ok = 0;
    for (let i = 0; i < n && sampled < 5; i++) {
      if (childSignature(kids[i]) !== topSig) continue;
      sampled++;
      try {
        const r = kids[i].getBoundingClientRect();
        if (r.width >= MIN_ITEM_W && r.height >= MIN_ITEM_H) ok++;
      } catch (e) {}
    }
    return sampled > 0 && ok >= Math.min(2, sampled);
  }

  function findFeeds() {
    const feeds = [];
    let nodes = [];
    try {
      nodes = document.querySelectorAll("ul,ol,div,section,main");
    } catch (e) {
      return feeds;
    }
    const limit = Math.min(nodes.length, SCAN_CAP);
    for (let i = 0; i < limit && feeds.length < MAX_FEEDS; i++) {
      const el = nodes[i];
      if (el.hasAttribute("data-zz-ui")) continue;
      if (isFeedContainer(el)) feeds.push(el);
    }
    return feeds;
  }

  // 空壳广告位判定（保守）：只删能确定是广告空壳的节点，
  // 骨架屏/懒加载占位一律保留，避免误删即将填充内容的卡片
  const SKELETON_RE = /skeleton|placeholder|loading|shimmer|spinner|lazy/i;
  const AD_NAME_RE = /(^|[^a-z0-9])(ad|ads|adv|sponsor|sponsored|popunder|popup|banner|exo|juicy|tsad|ts_ad|native-?ad|adslot|ad-box)([^a-z0-9]|$)/i;

  function hasIframe(child) {
    try {
      return child.tagName === "IFRAME" ? child : child.querySelector("iframe");
    } catch (e) {
      return null;
    }
  }

  function shouldDrop(child) {
    const kind = visibilityKind(child);
    if (kind === false) return false;
    if (hasRealContent(child)) return false;
    const idc = String((child.id || "") + " " + (typeof child.className === "string" ? child.className : ""));
    if (SKELETON_RE.test(idc)) return false;
    // 空 iframe 广告位（拦截后停留在 about:blank）
    const iframe = hasIframe(child);
    if (iframe && !iframeHasContent(iframe) && !(child.textContent || "").trim()) return true;
    if (AD_NAME_RE.test(idc)) return true;
    // 无目标地址的空链接（纯占位）
    if (child.tagName === "A") {
      const href = child.getAttribute("href") || "";
      if (!href || /^(javascript:|#|$)/i.test(href)) return true;
    }
    return false;
  }

  function repairFeed(feed) {
    let removed = 0;
    const kids = Array.from(feed.children);
    for (const child of kids) {
      if (removed >= MAX_REMOVE) return removed;
      try {
        if (child.hasAttribute("data-zz-ui")) continue;
        if (!shouldDrop(child)) continue;
        child.remove();
        removed++;
      } catch (e) {}
    }
    return removed;
  }

  function repairSiteSelectors() {
    const sels = SITE_FIXES[u.host()];
    if (!sels || !sels.length) return 0;
    let removed = 0;
    for (const sel of sels) {
      let nodes = [];
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (const el of nodes) {
        if (removed >= MAX_REMOVE) return removed;
        if (el.hasAttribute("data-zz-ui")) continue;
        const kind = visibilityKind(el);
        if (kind === false) continue;
        if (hasRealContent(el)) continue;
        try {
          el.remove();
          removed++;
        } catch (e) {}
      }
    }
    return removed;
  }

  function runPass() {
    if (!enabled() || state.running || document.fullscreenElement) return;
    state.running = true;
    const t0 = performance.now();
    let removed = 0;
    try {
      removed += repairSiteSelectors();
      if (removed < MAX_REMOVE) {
        const feeds = findFeeds();
        for (const feed of feeds) {
          removed += repairFeed(feed);
          if (removed >= MAX_REMOVE) break;
        }
      }
    } catch (e) {
      ZZ.log("flowfix pass error", e);
    }
    state.running = false;
    state.passCost = performance.now() - t0;
    if (removed) report(removed);
  }

  function enabled() {
    return !!(ZZ.Css && ZZ.Css.state && ZZ.Css.state.flowFix && ZZ.Css.state.enabled);
  }

  const schedulePass = u.debounce(runPass, 1200);

  function startObserver() {
    if (state.observer || !enabled()) return;
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
      const delay = state.passCost > 150 ? 3000 : 1200;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.timer = null;
        runPass();
      }, delay);
    });
    try {
      state.observer.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}
  }

  function start() {
    startObserver();
    u.idle(runPass);
    setTimeout(() => {
      if (enabled()) schedulePass();
    }, 3000);
  }

  ZZ.FlowFix = {
    runPass,
    start,
  };

  // 与 Css 模块同一套开关生命周期：规则更新后重读 flowFix 开关
  if (ZZ.bus && ZZ.bus.on) {
    ZZ.bus.on("rules-updated", () => start());
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => start());
  } else {
    start();
  }
})();

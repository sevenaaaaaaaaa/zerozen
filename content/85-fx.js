// 页面魔法特效：净化波（扫光 + 徽章）与阅读模式入场动画。
// 全部用 fixed 容器 + CSS 动画，pointer-events:none，不打断页面交互。
(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u || !u.isTop()) return;

  const FX_CSS =
    ".zz-fx-layer{position:fixed;inset:0;z-index:2147483646;pointer-events:none}" +
    ".zz-fx-sweep{position:absolute;left:0;right:0;top:-20%;height:36%;" +
    "background:linear-gradient(180deg,rgba(59,130,246,0) 0%,rgba(59,130,246,.10) 35%,rgba(125,211,252,.28) 55%,rgba(59,130,246,.10) 75%,rgba(59,130,246,0) 100%);" +
    "filter:blur(6px);transform:translateY(-40%);animation:zzFxSweep .95s cubic-bezier(.33,1,.68,1) forwards}" +
    "@keyframes zzFxSweep{0%{transform:translateY(-40%);opacity:0}18%{opacity:1}100%{transform:translateY(320%);opacity:0}}" +
    ".zz-fx-badge{position:fixed;top:18px;right:18px;z-index:2147483647;pointer-events:none;" +
    "display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:18px;" +
    "background:rgba(20,26,44,.62);border:1px solid rgba(255,255,255,.14);" +
    "box-shadow:0 8px 32px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.14);" +
    "backdrop-filter:blur(22px) saturate(1.7);-webkit-backdrop-filter:blur(22px) saturate(1.7);" +
    "color:#eef3fb;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',sans-serif;" +
    "transform:translateY(-12px) scale(.92);opacity:0;transition:transform .38s cubic-bezier(.34,1.56,.64,1),opacity .3s ease}" +
    ".zz-fx-badge.show{transform:translateY(0) scale(1);opacity:1}" +
    ".zz-fx-badge .ico{font-size:16px}" +
    ".zz-fx-badge b{color:#7dd3fc}";

  let layer = null;
  let cssDone = false;

  function ensureCss(root) {
    if (cssDone) return;
    const style = document.createElement("style");
    style.textContent = FX_CSS;
    (root || document.head || document.documentElement).appendChild(style);
    cssDone = true;
  }

  function getLayer() {
    if (layer && layer.isConnected) return layer;
    ensureCss();
    layer = document.createElement("div");
    layer.className = "zz-fx-layer";
    layer.setAttribute("data-zz-ui", "1");
    (document.body || document.documentElement).appendChild(layer);
    return layer;
  }

  let badgeTimer = null;
  function showBadge(html) {
    ensureCss();
    let badge = document.querySelector(".zz-fx-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "zz-fx-badge";
      badge.setAttribute("data-zz-ui", "1");
      (document.body || document.documentElement).appendChild(badge);
    }
    badge.innerHTML = html;
    requestAnimationFrame(() => badge.classList.add("show"));
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      badge.classList.remove("show");
    }, 2600);
  }

  // 净化波：一道光从页面顶部扫到底部，随后弹出玻璃徽章
  function cleanWave(count) {
    if (document.fullscreenElement) return;
    const box = getLayer();
    box.querySelectorAll(".zz-fx-sweep").forEach((el) => el.remove());
    const sweep = document.createElement("div");
    sweep.className = "zz-fx-sweep";
    box.appendChild(sweep);
    setTimeout(() => sweep.remove(), 1100);
    showBadge('<span class="ico">✨</span><span>' + ZZ.T("已净化本页") + (count ? ' <b>× ' + count + "</b>" : "") + "</span>");
  }

  // 阅读模式入场：页面主体先渐次下沉淡出，再由调用方挂载阅读层。
  // 记录被改动的元素原样式，退出时由 readerOut 恢复（否则原页面会永久隐身）
  let readerTouched = [];
  function readerIn(mount) {
    ensureCss();
    readerTouched = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (typeof mount === "function") mount();
    };
    try {
      const kids = Array.from((document.body || document.documentElement).children).filter(
        (el) => !el.hasAttribute("data-zz-ui") && el.tagName !== "SCRIPT" && el.tagName !== "STYLE"
      );
      if (!kids.length) {
        finish();
        return;
      }
      kids.slice(0, 30).forEach((el, i) => {
        try {
          readerTouched.push({
            el,
            prev: el.getAttribute("style") || "",
          });
        } catch (e) {}
        el.style.transition =
          "opacity .42s ease " + i * 26 + "ms, transform .42s ease " + i * 26 + "ms, filter .42s ease " + i * 26 + "ms";
        el.style.opacity = "0";
        el.style.transform = "translateY(10px) scale(.99)";
        el.style.filter = "blur(4px)";
      });
      setTimeout(finish, 480 + Math.min(30, kids.length) * 26);
    } catch (e) {
      finish();
    }
  }

  function readerOut() {
    // 先整体淡入再一次性还原原样式，避免动画中途闪烁
    for (const t of readerTouched) {
      try {
        if (!t.el.isConnected) continue;
        t.el.style.transition = "opacity .4s ease, transform .4s ease, filter .4s ease";
        t.el.style.opacity = "";
        t.el.style.transform = "";
        t.el.style.filter = "";
        const prev = t.prev;
        setTimeout(() => {
          try {
            if (prev) t.el.setAttribute("style", prev);
            else {
              t.el.removeAttribute("style");
              t.el.style.transition = "";
            }
          } catch (e) {}
        }, 420);
      } catch (e) {}
    }
    readerTouched = [];
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "zz:fx:clean") {
      cleanWave((msg.payload && msg.payload.count) || 0);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  ZZ.FX = { cleanWave, readerIn, readerOut, showBadge };
})();

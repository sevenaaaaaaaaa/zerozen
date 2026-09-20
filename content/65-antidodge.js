(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u || !u.isTop || !u.isTop()) return;

  const WALL_TEXT =
    /(adblock|ad ?blocker|ad-block|disable your ad|turn off your ad|disable adblock|whitelist us|support us by disabling|广告拦截|拦截广告|关闭广告|禁用广告|请关闭.{0,8}广告|关闭.{0,6}拦截|広告ブロック|広告を非表示|광고 차단|광고를 차단|werbeblocker|bloqueur de publicit|bloqueador de anuncios|desactive.*bloqueur)/i;

  const WALL_SELECTOR = [
    "[id*='adblock' i]",
    "[class*='adblock' i]",
    "[id*='ad-block' i]",
    "[class*='ad-block' i]",
    "[id*='adblocker' i]",
    "[class*='adblocker' i]",
    "[class*='anti-ad' i]",
    "[class*='antiad' i]",
    "[class*='ad-blocker' i]",
  ].join(",");

  const reported = { done: false, at: 0 };
  const timers = [];

  function textOf(el, limit) {
    try {
      return String(el.innerText || el.textContent || "").slice(0, limit || 400);
    } catch (e) {
      return "";
    }
  }

  function visible(el) {
    try {
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 40) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") < 0.5) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function overlayish(el) {
    try {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const area = (r.width * r.height) / (vw * vh);
      if (area >= 0.25) return true;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && parseInt(cs.zIndex || "0", 10) >= 100) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function findWall() {
    let nodes = [];
    try {
      nodes = document.querySelectorAll(WALL_SELECTOR);
    } catch (e) {}
    for (const el of nodes) {
      if (!visible(el)) continue;
      if (!WALL_TEXT.test(textOf(el))) continue;
      return el;
    }
    const scopes = document.querySelectorAll("div,section,aside,dialog,main,body > *");
    const limit = Math.min(scopes.length, 400);
    for (let i = 0; i < limit; i++) {
      const el = scopes[i];
      const text = textOf(el);
      if (!text || !WALL_TEXT.test(text)) continue;
      if (!overlayish(el) || !visible(el)) continue;
      return el;
    }
    return null;
  }

  function report() {
    if (reported.done) return;
    const wall = findWall();
    if (!wall) return;
    reported.done = true;
    reported.at = Date.now();
    let selector = "";
    try {
      selector = wall.id ? "#" + wall.id : wall.className && typeof wall.className === "string" ? "." + wall.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    } catch (e) {}
    ZZ.send({
      type: "zz:antiadblock",
      payload: {
        host: u.host(),
        selector: String(selector).slice(0, 120),
        sample: textOf(wall, 80),
      },
    });
  }

  function schedule() {
    for (const ms of [1500, 4000, 9000]) {
      timers.push(setTimeout(report, ms));
    }
    try {
      const obs = new MutationObserver(() => {
        if (reported.done) {
          obs.disconnect();
          return;
        }
        clearTimeout(report.__t);
        report.__t = setTimeout(report, 1200);
      });
      obs.observe(document.documentElement || document, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 20000);
    } catch (e) {}
  }

  function init() {
    const state = ZZ.Css && ZZ.Css.state;
    if (!state || !state.enabled) return;
    schedule();
  }

  if (document.readyState === "complete") setTimeout(init, 400);
  else window.addEventListener("load", () => setTimeout(init, 400), { once: true });
  ZZ.bus.on("rules-updated", () => {
    if (!reported.done) report();
  });
})();

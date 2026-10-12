// 浮层判定：证据打分制，决定一个 fixed/absolute 高层浮层是「广告弹层」还是「正常弹窗」。
//
// 原则：默认不碰。只有拿到广告证据才处理，且正常弹窗的信号会抵消软证据：
//   硬证据（直接判广告）：广告联盟 iframe / 浮层内链接指向广告联盟 / 元素或近祖先命名带广告词
//   软证据（需要无正常信号才算）：整屏透明且无内容的点击劫持层、插屏倒计时+站外链接、角落悬浮「广告」小窗
//   正常信号：role=dialog / aria-modal / <dialog>、主流 UI 框架弹窗类名、Cookie/隐私同意框、
//            登录/验证码、含表单控件、用户刚点击（2.5 秒内）后才出现、正在做入场动画
(function () {
  const ZZ = globalThis.ZZ;
  if (!ZZ || !ZZ.u) return;

  const AD_HOST_RE =
    /(^|\.)(doubleclick|googlesyndication|googleadservices|adnxs|criteo|taboola|outbrain|mgid|revcontent|magsrv|pemsrv|wpadmngr|exoclick|exosrv|realsrv|exdynsrv|juicyads|juicycdn|trafficjunky|tsyndicate|trafficstars|popads|popcash|propeller(ads|pops)?|onclasrv|onclickads|clickadu|adcash|adsterra|adskeeper|hilltopads|adspyglass|traffichunt|zeropark|plugrush|twinrd(srv|engine)|trafficfactory|galaksion|clickaine|ad-?maven|monetag|richpush|pos\.baidu|cpro\.baidu|union\.360|tanx|alimama|gdt\.qq|pangolin-sdk-toutiao|adsterra)\./i;
  // 名字里的广告词必须是独立 token（ad-box、ads_wrap、sponsor…），download/header/shadow 这类不算
  const AD_NAME_RE =
    /(^|[^a-z0-9])(ad|ads|adv|advert|advertisement|adbox|adwrap|adlayer|adpop|admask|sponsor|sponsored|popunder|interstitial|exo|juicy|tsad|ts_ad|guanggao|tuiguang)([^a-z0-9]|$)/i;
  const AD_SRC_RE = /(^|[./_?#-])(ads?|adsystem|adservice|adserver|advert|banner|popunder|popads|popcash)([./_?#-]|$)/i;
  const LEGIT_NAME_RE =
    /(^|[\s_-])(modal|dialog|drawer|lightbox|fancybox|pswp|photoswipe|viewer|gallery|cookie|consent|gdpr|ccpa|onetrust|cookiebot|didomi|truste|qc-cmp|cmp|toast|snackbar|notification|tooltip|popover|dropdown|menu|navbar|nav|sidebar|ant-|el-|mui|chakra|van-|layui|layer|swal|sweet|tippy|select|picker|calendar|datepicker|share|preview|zoom|login|signin|signup|register|auth|passport|captcha|verify|geetest|tcaptcha|nc_|feedback|chat|support|help|search|cart|checkout|player|video)/i;
  const INTERSTITIAL_TEXT_RE =
    /(\d+\s*(秒|s|sec)\s*(后|後)?\s*(关闭|跳过|skip|close))|(跳过广告|关闭广告|skip ad|close ad|advertisement|sponsored|广告)/i;

  // 用户最近一次真实操作：之后 2.5 秒内出现的浮层视为用户主动打开
  const userAct = { t: 0 };
  for (const type of ["pointerdown", "keydown", "touchstart"]) {
    try {
      window.addEventListener(type, (e) => {
        if (e.isTrusted) userAct.t = Date.now();
      }, true);
    } catch (e) {}
  }

  const firstSeen = new WeakMap();
  // 元素何时「出现」：插入 DOM 或切换 class/style/hidden 的时间。页面初始就有的元素没有记录（视为 0）。
  // 用于判断浮层是不是用户点击后才打开的——不能用扫描时间，后台标签页的扫描可能被节流到用户操作之后
  const changedAt = new WeakMap();
  try {
    new MutationObserver((records) => {
      const now = Date.now();
      for (const r of records) {
        if (r.type === "attributes") changedAt.set(r.target, now);
        else for (const n of r.addedNodes) if (n.nodeType === 1) changedAt.set(n, now);
      }
    }).observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open"],
    });
  } catch (e) {}

  function appearedAt(el) {
    let n = el;
    let latest = 0;
    for (let i = 0; i < 4 && n && n !== document.body; i++) {
      const t = changedAt.get(n);
      if (t && t > latest) latest = t;
      n = n.parentElement;
    }
    return latest;
  }

  function idc(el) {
    if (!el) return "";
    const cls = typeof el.className === "string" ? el.className : (el.getAttribute && el.getAttribute("class")) || "";
    return String((el.id || "") + " " + cls);
  }

  function hostOf(url) {
    try {
      return new URL(url, location.href).hostname.toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function siteOf(host) {
    const parts = String(host || "").split(".").filter(Boolean);
    if (parts.length <= 2) return parts.join(".");
    const sl = parts[parts.length - 2];
    if (/^(com|net|org|gov|edu|co|ac)$/.test(sl) && parts[parts.length - 1].length === 2) return parts.slice(-3).join(".");
    return parts.slice(-2).join(".");
  }

  function crossSite(url) {
    const h = hostOf(url);
    return !!h && siteOf(h) !== siteOf(location.hostname);
  }

  function animating(el, cs) {
    try {
      if (el.getAnimations && el.getAnimations({ subtree: false }).some((a) => a.playState === "running")) return true;
    } catch (e) {}
    const op = parseFloat(cs.opacity || "1");
    // 有 opacity/transform 过渡且尚未到终态：多半是入场动画
    return op < 0.95 && /opacity|all|transform/.test(cs.transitionProperty || "") && parseFloat(cs.transitionDuration || "0") > 0;
  }

  function legitSignals(el) {
    const out = [];
    try {
      if (el.tagName === "DIALOG" || el.closest("dialog")) out.push("dialog");
      const role = el.getAttribute("role");
      if (role === "dialog" || role === "alertdialog" || el.getAttribute("aria-modal") === "true") out.push("role");
      else if (el.querySelector("[role=dialog],[role=alertdialog],[aria-modal=true],dialog")) out.push("role-inner");
      if (LEGIT_NAME_RE.test(idc(el)) || LEGIT_NAME_RE.test(idc(el.firstElementChild))) out.push("name");
      if (el.querySelector("input:not([type=hidden]), textarea, select, form, [contenteditable=true]")) out.push("form");
      if (el.querySelector("iframe[src*='captcha'], iframe[src*='recaptcha'], iframe[src*='challenge']")) out.push("captcha");
      if (el.contains(document.activeElement) && document.activeElement !== document.body) out.push("focus");
    } catch (e) {}
    return out;
  }

  function visibleContent(el) {
    try {
      const text = (el.innerText || "").trim();
      if (text.length > 0) return true;
      return !!el.querySelector("img, video, canvas, svg, picture, button, iframe");
    } catch (e) {
      return true;
    }
  }

  function adLinks(el) {
    let ad = 0;
    let cross = 0;
    try {
      const links = el.tagName === "A" ? [el] : Array.from(el.querySelectorAll("a[href]")).slice(0, 30);
      for (const a of links) {
        const href = a.href || "";
        if (AD_HOST_RE.test("." + hostOf(href) + ".")) ad++;
        else if (crossSite(href)) cross++;
      }
    } catch (e) {}
    return { ad, cross };
  }

  function adNamed(el) {
    let n = el;
    for (let i = 0; i < 3 && n && n !== document.body; i++) {
      if (AD_NAME_RE.test(idc(n))) return true;
      n = n.parentElement;
    }
    return false;
  }

  /**
   * 判定一个浮层。返回 { verdict: "ad" | "legit" | "skip" | "wait", reasons: [] }
   * - ad：处理（淡出隐藏）  legit/skip：不碰  wait：入场动画中，稍后复查
   */
  function judge(el, cs, geo) {
    const reasons = [];
    if (!firstSeen.has(el)) firstSeen.set(el, Date.now());
    const shown = appearedAt(el);
    const userOpened = !!userAct.t && !!shown && shown - userAct.t >= -50 && shown - userAct.t < 2500;

    // —— 硬证据 ——
    let iframe = null;
    try {
      iframe = el.tagName === "IFRAME" ? el : el.querySelector("iframe");
    } catch (e) {}
    const src = iframe ? iframe.src || iframe.getAttribute("src") || "" : "";
    const iframeAd = !!(iframe && (AD_HOST_RE.test("." + hostOf(src) + ".") || (crossSite(src) && AD_SRC_RE.test(src))));
    if (iframeAd) reasons.push("ad-iframe");
    const links = adLinks(el);
    if (links.ad) reasons.push("ad-link");
    const named = adNamed(el);
    if (named) reasons.push("ad-name");
    const hard = iframeAd || links.ad > 0 || (named && (geo.fullish || geo.stickyBar || geo.corner));
    if (hard) return { verdict: "ad", reasons };

    // 软证据只对 fixed 层生效：absolute 层多是下拉菜单、轮播、地图图层
    if (geo.pos !== "fixed") return { verdict: "skip", reasons };

    const legit = legitSignals(el);
    if (legit.length) return { verdict: "legit", reasons: legit };
    if (userOpened) return { verdict: "legit", reasons: ["user-opened"] };
    if (animating(el, cs) && Date.now() - firstSeen.get(el) < 1500) return { verdict: "wait", reasons: ["animating"] };

    // —— 软证据 ——
    const hasContent = visibleContent(el);
    const transparent =
      parseFloat(cs.opacity || "1") < 0.2 || cs.backgroundColor === "transparent" || cs.backgroundColor === "rgba(0, 0, 0, 0)";
    // 整屏、透明、没有任何可见内容，还能接住点击：点击劫持层
    if (geo.fullish && geo.z >= 100 && transparent && !hasContent && cs.pointerEvents !== "none") {
      reasons.push("clickjack");
      return { verdict: "ad", reasons };
    }
    if (geo.fullish && el.childElementCount === 0 && (cs.cursor === "pointer" || geo.z >= 9999) && cs.pointerEvents !== "none") {
      reasons.push("empty-full");
      return { verdict: "ad", reasons };
    }
    let text = "";
    try {
      // innerText 不含被隐藏的子节点（「广告」角标常被别的规则先隐藏），回落到 textContent
      text = ((el.innerText || "").trim() || (el.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 300);
    } catch (e) {}
    // 插屏：整屏 + 倒计时/「广告」字样 + 站外链接
    if (geo.fullish && links.cross > 0 && INTERSTITIAL_TEXT_RE.test(text) && text.length < 200) {
      reasons.push("interstitial");
      return { verdict: "ad", reasons };
    }
    // 角落悬浮小窗：带「广告」标签 + 站外链接 + 图片
    if ((geo.corner || geo.stickyBar) && links.cross > 0 && /(^|\s)(广告|AD|Ad|Sponsored|赞助)(\s|$)/.test(text) && el.querySelector("img, video, iframe")) {
      reasons.push("ad-float");
      return { verdict: "ad", reasons };
    }
    return { verdict: "skip", reasons };
  }

  ZZ.Overlay = { judge, adNamed, userAct, siteOf };
})();

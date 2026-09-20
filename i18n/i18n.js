(function () {
  const g = globalThis;
  const ZZ = (g.ZZ = g.ZZ || {});
  if (ZZ.I18n) return;

  const LANGS = ["zh", "en"];
  let lang = null;

  function uiLanguage() {
    try {
      const api = ZZ.browser || g.chrome || g.browser;
      if (api && api.i18n && api.i18n.getUILanguage) return api.i18n.getUILanguage();
    } catch (e) {}
    if (g.navigator && navigator.language) return navigator.language;
    return "en";
  }

  function detect() {
    return /^zh\b|^zh-/i.test(String(uiLanguage() || "")) ? "zh" : "en";
  }

  function dict() {
    return (lang === "en" && g.ZZ_DICT_EN) || null;
  }

  // 中文原文即 key：中文界面直接返回原文，英文界面查词典，查不到时回落原文
  function T(text, ...subs) {
    let out = String(text == null ? "" : text);
    if (lang === null) lang = detect();
    const d = dict();
    if (d && Object.prototype.hasOwnProperty.call(d, out)) out = d[out];
    // 始终替换占位符：漏传参数时输出空串，而不是把 $1 直接显示给用户
    return out.replace(/\$(\d+)/g, (m, i) => {
      const v = subs[Number(i) - 1];
      return v === undefined || v === null ? "" : String(v);
    });
  }

  const I18n = {
    LANGS,
    T,
    lang() {
      if (lang === null) lang = detect();
      return lang;
    },
    detect,
    // "auto" | "zh" | "en"
    setLang(value) {
      if (value === "zh" || value === "en") lang = value;
      else lang = detect();
      return lang;
    },
    has(text) {
      const d = g.ZZ_DICT_EN;
      return !!(d && Object.prototype.hasOwnProperty.call(d, String(text)));
    },
    // 给页面用：把 data-i18n / data-i18n-ph / data-i18n-title 标注的节点翻译一遍
    applyDom(root) {
      const scope = root || (g.document && g.document.documentElement);
      if (!scope || !scope.querySelectorAll) return 0;
      let n = 0;
      const self = scope.getAttribute && scope.getAttribute("data-i18n") ? [scope] : [];
      for (const el of self.concat(Array.from(scope.querySelectorAll("[data-i18n]")))) {
        el.textContent = T(el.getAttribute("data-i18n"));
        n++;
      }
      for (const el of Array.from(scope.querySelectorAll("[data-i18n-ph]"))) {
        el.setAttribute("placeholder", T(el.getAttribute("data-i18n-ph")));
        n++;
      }
      for (const el of Array.from(scope.querySelectorAll("[data-i18n-title]"))) {
        el.setAttribute("title", T(el.getAttribute("data-i18n-title")));
        n++;
      }
      if (g.document && g.document.documentElement) {
        g.document.documentElement.setAttribute("lang", I18n.lang() === "en" ? "en" : "zh-CN");
      }
      return n;
    },
  };

  ZZ.I18n = I18n;
  ZZ.T = T;
})();

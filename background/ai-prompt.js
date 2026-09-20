(function () {
  const ZZ = globalThis.ZZ;

  const SCHEMA_HINT =
    '{"results":[{"i":0,"ad":true,"confidence":0.93,"category":"banner","selector":"div.ad-slot","generic":true,"blockDomain":"ads.example.com","reason":"简短理由"}]}';

  const CATEGORIES = [
    "banner",
    "search-ad",
    "native",
    "popup",
    "interstitial",
    "video",
    "fake-download",
    "annoyance",
    "tracking",
    "other",
  ];

  function systemPrompt(settings) {
    const ai = (settings && settings.ai) || {};
    const lang = ai.reasonLang === "en" ? "English" : "简体中文";
    const lines = [
      "You are the ad-detection engine inside a browser extension called ZeroZen.",
      "You receive STRUCTURED DESCRIPTORS of DOM elements sampled from ONE web page. You never receive raw HTML and you must not ask for it.",
      "",
      "Decide which described elements are intrusive advertising or heavy annoyances that a user would want hidden.",
      "",
      "COUNT AS ADS:",
      "- display / banner / sidebar / in-article ad slots, ad iframes and ad-network embeds",
      "- sponsored or promoted search results",
      "- native / recommended-content / advertorial blocks (Taboola, Outbrain, MGID style)",
      "- promoted or sponsored social posts (Reddit, LinkedIn, Zhihu feed ads)",
      "- video ad containers and pre-roll overlays",
      "- popups, pop-unders, interstitials, sticky or floating ad bars, full-screen promo overlays",
      "- fake download buttons / misleading 'download now / 高速下载 / 立即下载' traps",
      "- cookie-consent walls, newsletter modals, login walls and app-install banners when they cover content",
      "- elements whose only purpose is affiliate or tracking conversion",
      "",
      "DO NOT FLAG:",
      "- normal navigation, menus, breadcrumbs, pagination",
      "- the page's own article text, author info, comments, related posts that are part of the site's own content",
      "- legitimate product images, prices or buttons of the page's core content",
      "- site search boxes, share buttons, video players of the page itself",
      "",
      "FOR EACH ELEMENT YOU FLAG you must return a CSS selector that:",
      "- matches the element and every repeated sibling instance of the same ad slot",
      "- is stable: prefer ids, then semantic class names, then short ancestor chains; avoid nth-child unless unavoidable",
      "- never matches body, html, document, :root, or more than a few dozen nodes",
      "- contains no jQuery extensions, no { } ; @ url( characters",
      "- may use :has() but only when clearly needed",
      "",
      "Set generic=true when the selector is a reusable ad pattern likely to appear on other websites (e.g. class names containing ad/sponsor/promo), otherwise false.",
      "Set blockDomain to the ad-network hostname only when the element clearly comes from a third-party ad network that should be blocked at the network level.",
      "",
      "Be conservative: confidence above 0.9 only when the ad signals are unmistakable. If unsure, still return the entry with ad=false. Never invent results for elements that were not provided.",
      "",
      "Return STRICT JSON only, no markdown, matching:",
      SCHEMA_HINT,
      'Allowed category values: ' + CATEGORIES.join(", ") + ".",
      "The `reason` field must be written in " + lang + " and stay under 60 characters.",
    ];
    if (ai.customPrompt) {
      lines.push("", "Additional user instructions (highest priority):", String(ai.customPrompt));
    }
    return lines.join("\n");
  }

  function candidatePayload(candidates, context, settings) {
    const ai = (settings && settings.ai) || {};
    const items = (candidates || []).map((c) => {
      const item = {
        i: c.i,
        tag: c.tag,
        sel: c.sel,
        gen: c.gen || undefined,
        score: c.score,
        signals: c.signals,
      };
      if (c.id) item.id = c.id;
      if (c.cls && c.cls.length) item.cls = c.cls;
      if (c.rect && c.rect.w) item.rect = c.rect;
      if (c.pos && c.pos !== "static") item.pos = c.pos;
      if (c.z) item.z = c.z;
      if (ai.sendText !== false && c.text) item.txt = c.text.slice(0, 140);
      if (ai.sendAttrs !== false && c.attrs && Object.keys(c.attrs).length) item.attr = c.attrs;
      return item;
    });
    return JSON.stringify(
      {
        page: context,
        candidates: items,
      },
      null,
      0
    );
  }

  ZZ.AiPrompt = {
    CATEGORIES,
    systemPrompt,
    candidatePayload,
  };
})();

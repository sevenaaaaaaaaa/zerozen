(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u || !ZZ.bus) return;

  const AD_HOST_PATTERNS = [
    /(^|\.)doubleclick\.net$/,
    /(^|\.)googlesyndication\.com$/,
    /(^|\.)googleadservices\.com$/,
    /(^|\.)adservice\.google\.com$/,
    /(^|\.)adnxs(-simple)?\.com$/,
    /(^|\.)criteo\.(com|net)$/,
    /(^|\.)taboola\.com$/,
    /(^|\.)outbrain\.com$/,
    /(^|\.)mgid\.com$/,
    /(^|\.)revcontent\.com$/,
    /(^|\.)pubmatic\.com$/,
    /(^|\.)rubiconproject\.com$/,
    /(^|\.)openx\.net$/,
    /(^|\.)adform\.net$/,
    /(^|\.)smartadserver\.com$/,
    /(^|\.)yieldmo\.com$/,
    /(^|\.)sharethrough\.com$/,
    /(^|\.)teads\.tv$/,
    /(^|\.)sovrn\.com$/,
    /(^|\.)lijit\.com$/,
    /(^|\.)gumgum\.com$/,
    /(^|\.)33across\.com$/,
    /(^|\.)amazon-adsystem\.com$/,
    /(^|\.)adsrvr\.org$/,
    /(^|\.)casalemedia\.com$/,
    /(^|\.)360yield\.com$/,
    /(^|\.)bidswitch\.net$/,
    /(^|\.)adroll\.com$/,
    /(^|\.)quantserve\.com$/,
    /(^|\.)scorecardresearch\.com$/,
    /(^|\.)moatads\.com$/,
    /(^|\.)adsafeprotected\.com$/,
    /(^|\.)doubleverify\.com$/,
    /(^|\.)exoclick\.com$/,
    /(^|\.)(exosrv|realsrv|exdynsrv|magsrv|pemsrv|wpadmngr|twinrdsrv|twinrdengine)\.com$/,
    /(^|\.)juicyads\.com$/,
    /(^|\.)trafficjunky\.net$/,
    /(^|\.)adspyglass\.com$/,
    /(^|\.)ero-advertising\.com$/,
    /(^|\.)popads\.net$/,
    /(^|\.)popcash\.net$/,
    /(^|\.)propellerads\.com$/,
    /(^|\.)onclasrv\.com$/,
    /(^|\.)clickadu\.com$/,
    /(^|\.)adcash\.com$/,
    /(^|\.)tsyndicate\.com$/,
    /(^|\.)adsterra\.com$/,
    /(^|\.)adskeeper\.com$/,
    /(^|\.)hilltopads\.net$/,
    /(^|\.)traffichunt\.com$/,
    /(^|\.)zeropark\.com$/,
    /(^|\.)pos\.baidu\.com$/,
    /(^|\.)cpro\.baidu\.com$/,
    /(^|\.)cbjs\.baidu\.com$/,
    /(^|\.)union\.360\.cn$/,
    /(^|\.)tanx\.com$/,
    /(^|\.)alimama\.(com|cn)$/,
    /(^|\.)mmstat\.com$/,
    /(^|\.)miaozhen\.com$/,
    /(^|\.)admaster\.com\.cn$/,
    /(^|\.)gdt\.qq\.com$/,
    /(^|\.)ad\.qq\.com$/,
    /(^|\.)pangolin-sdk-toutiao\.com$/,
    /(^|\.)pglstatp-toutiao\.com$/,
    /(^|\.)snssdk\.com$/,
    /(^|\.)bytedance\.com$/,
    /(^|\.)oceanengine\.com$/,
    /(^|\.)adcome\.cn$/,
    /(^|\.)ipinyou\.com$/,
    /(^|\.)mediav\.com$/,
    /(^|\.)adview\.cn$/,
    /(^|\.)domob\.cn$/,
    /(^|\.)duomeng\.cn$/,
    /(^|\.)zhaopin\.com\/ad$/,
  ];

  const AD_HOST_HINT = /(^|[.-])(ads?|adserv|adserver|advert|adtech|banner|sponsor|promo|taboola|outbrain|mgid|revcontent|exoclick|popads|propeller|adcash|adsterra|adskeeper|trafficjunky|juicyads|preroll)([.-]|$)/i;

  const TOKEN_WEIGHTS = {
    ad: 22,
    ads: 22,
    adsbygoogle: 65,
    adv: 18,
    advert: 30,
    adverts: 30,
    advertisement: 30,
    advertisements: 30,
    advertising: 26,
    adunit: 34,
    adunits: 34,
    adserver: 34,
    adslot: 34,
    adbox: 30,
    adwrap: 30,
    adwrapper: 30,
    adcontainer: 30,
    adsense: 55,
    adwords: 40,
    dfp: 30,
    gpt: 26,
    sponsor: 20,
    sponsored: 30,
    sponsoring: 20,
    promoted: 30,
    promotion: 16,
    promo: 16,
    aff: 10,
    affiliate: 16,
    banner: 14,
    popup: 16,
    popunder: 45,
    interstitial: 26,
    overlay: 12,
    lightbox: 10,
    preroll: 26,
    prebid: 34,
    taboola: 50,
    outbrain: 50,
    mgid: 50,
    revcontent: 50,
    exoclick: 60,
    juicyads: 55,
    trafficjunky: 55,
    propeller: 45,
    popads: 55,
    adcash: 45,
    adsterra: 50,
    adskeeper: 50,
    clickadu: 45,
    tsyndicate: 45,
    hilltopads: 45,
    adspyglass: 50,
    eroadvertising: 50,
    tuiguang: 30,
    guanggao: 30,
  };

  const CN_KEYWORDS = [
    { re: /广告位|广告条|广告图片|广告内容|广告推荐|广告联盟/, score: 30 },
    { re: /广告|推广|赞助|招商|投放/, score: 24 },
  ];

  const AD_LABELS = [
    "ad",
    "ads",
    "advertisement",
    "advertisements",
    "sponsored",
    "sponsored content",
    "sponsored post",
    "promoted",
    "promoted post",
    "paid content",
    "paid partnership",
    "presented by",
    "广告",
    "广告 ·",
    "广告·",
    "· 广告",
    "赞助",
    "赞助内容",
    "推广",
    "推广内容",
    "商业推广",
    "品牌广告",
    "广告推广",
  ];

  const DOWNLOAD_WORDS = [
    "高速下载",
    "立即下载",
    "点击下载",
    "极速下载",
    "安全下载",
    "官方下载",
    "免费下载",
    "下载地址",
    "download now",
    "free download",
    "download",
    "立即购买",
    "限时抢购",
    "立即领取",
    "点此进入",
    "click here",
  ];

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "LINK",
    "META",
    "HEAD",
    "TITLE",
    "NOSCRIPT",
    "TEMPLATE",
    "BR",
    "HR",
    "HTML",
    "BODY",
    "CANVAS",
    "AUDIO",
    "SOURCE",
    "TRACK",
    "SVG",
    "PATH",
    "G",
    "DEFS",
    "USE",
    "CIRCLE",
    "RECT",
    "LINE",
    "POLYGON",
    "POLYLINE",
    "TEXT",
    "PATTERN",
    "MASK",
    "CLIPPATH",
    "LINEARGRADIENT",
    "RADIALGRADIENT",
    "STOP",
    "SYMBOL",
    "FILTER",
    "FOREIGNOBJECT",
    "MARKER",
    "VIEW",
    "ANIMATE",
  ]);

  const ATTR_SCAN_TAGS = new Set(["DIV", "SECTION", "ASIDE", "A", "LI", "SPAN", "P", "UL", "IFRAME", "INS", "EMBED", "OBJECT", "ARTICLE", "MAIN", "HEADER", "FOOTER", "FORM", "FIGURE"]);

  function hostIsAd(host) {
    if (!host) return false;
    const h = host.toLowerCase();
    for (const re of AD_HOST_PATTERNS) if (re.test(h)) return true;
    return AD_HOST_HINT.test(h);
  }

  function tokenScore(text) {
    if (!text) return 0;
    const tokens = String(text).toLowerCase().split(/[^a-z0-9]+/);
    let best = 0;
    let hits = 0;
    for (const token of tokens) {
      if (!token) continue;
      const w = TOKEN_WEIGHTS[token];
      if (w) {
        hits++;
        if (w > best) best = w;
      }
    }
    let score = best;
    if (hits > 1) score += Math.min(16, (hits - 1) * 8);
    for (const item of CN_KEYWORDS) {
      if (item.re.test(text)) score = Math.max(score, item.score);
    }
    return score;
  }

  function labelScore(text) {
    if (!text) return 0;
    const t = text.toLowerCase().trim();
    if (t.length > 24) return 0;
    for (const label of AD_LABELS) {
      if (t === label) return 30;
      if (t.length <= 14 && t.startsWith(label) && t.length - label.length <= 6) return 26;
    }
    return 0;
  }

  function downloadScore(text) {
    if (!text) return 0;
    const t = text.toLowerCase().trim();
    if (t.length > 24) return 0;
    for (const word of DOWNLOAD_WORDS) {
      if (t === word) return 26;
      if (t.startsWith(word) && t.length - word.length <= 8) return 22;
    }
    return 0;
  }

  function inlineOverlayHint(el) {
    if (!el.hasAttribute("style")) return false;
    const style = el.getAttribute("style") || "";
    return /position\s*:\s*(fixed|sticky)/i.test(style) || /z-index\s*:\s*\d{3,}/i.test(style);
  }

  function score(el, env) {
    const tag = el.tagName;
    const id = el.id || "";
    const cls = typeof el.className === "string" ? el.className : "";
    const hay = id + " " + cls;
    let score = 0;
    const signals = [];
    let adHost = "";

    const kw = tokenScore(hay);
    if (kw) {
      score += kw;
      signals.push(ZZ.T("class/id 广告特征"));
    }

    const isAdTag = tag === "IFRAME" || tag === "INS" || tag === "EMBED" || tag === "OBJECT";
    if (!score && !isAdTag && !inlineOverlayHint(el)) return null;
    if (!score && env.strict && !isAdTag) return null;

    let attrs = null;
    const canScanAttrs = score > 0 || isAdTag || (!env.strict && ATTR_SCAN_TAGS.has(tag) && el.attributes.length <= 10);
    if (canScanAttrs) {
      attrs = u.attrsOf(el, 8);
      for (const [name, value] of Object.entries(attrs)) {
        const lname = name.toLowerCase();
        if (lname === "src" || lname === "href") continue;
        if (lname === "aria-label" || lname === "title" || lname === "role") {
          const ls = labelScore(value);
          if (ls) {
            score += ls;
            signals.push(ZZ.T("标签：$1", String(value).slice(0, 20)));
          }
          continue;
        }
        if (lname.startsWith("data-")) {
          const parts = lname.split("-");
          const hasAdToken = parts.some((p) => TOKEN_WEIGHTS[p]);
          const valueLabel = labelScore(value);
          if (hasAdToken) {
            score += 38;
            signals.push(ZZ.T("data 广告属性：$1", lname));
          } else if (valueLabel && /tools|label|type|name|pos/i.test(lname)) {
            score += 28;
            signals.push(ZZ.T("data 标签：$1", String(value).slice(0, 20)));
          }
        }
      }
    }

    if (tag === "IFRAME") {
      const src = el.getAttribute("src") || "";
      let host = "";
      try {
        host = new URL(src, env.url).hostname;
      } catch (e) {
        host = "";
      }
      if (host && (hostIsAd(host) || host !== env.host)) {
        const selfHostAd = hostIsAd(host);
        if (selfHostAd) {
          score += 65;
          adHost = host;
          signals.push(ZZ.T("广告联盟 iframe：$1", host));
        } else if (host !== env.host && score > 0) {
          score += 12;
          signals.push(ZZ.T("站外 iframe：$1", host));
        }
      }
      if (src === "about:blank" && score > 0) {
        score += 10;
        signals.push(ZZ.T("空白 iframe"));
      }
    }

    if (tag === "INS" && /adsbygoogle/i.test(hay)) {
      score += 40;
      signals.push("adsbygoogle");
    }

    if (el.children.length <= 3) {
      const text = u.textOf(el, 60);
      if (text) {
        const ls = labelScore(text);
        if (ls) {
          score += ls;
          signals.push(ZZ.T("文本标签：$1", text.slice(0, 16)));
        } else {
          const ds = downloadScore(text);
          if (ds) {
            score += ds;
            signals.push(ZZ.T("诱导文案：$1", text.slice(0, 16)));
            const link = el.tagName === "A" ? el : el.querySelector("a[href]");
            if (link) {
              let lhost = "";
              try {
                lhost = new URL(link.getAttribute("href"), env.url).hostname;
              } catch (e) {
                lhost = "";
              }
              if (lhost && lhost !== env.host) {
                score += 14;
                signals.push(ZZ.T("站外下载链接：$1", lhost));
              }
            }
          }
        }
      }
    }

    const needStyle = score > 0 || inlineOverlayHint(el);
    if (needStyle && env.view) {
      const style = u.styleOf(el);
      if (style) {
        env.pos = style.position;
        env.z = parseInt(style.zIndex, 10) || 0;
        const fixed = style.position === "fixed" || style.position === "sticky";
        if (fixed && env.z >= 1000) {
          const rect = u.rectOf(el);
          const ratio = env.vw && env.vh ? (rect.w * rect.h) / (env.vw * env.vh) : 0;
          if (ratio >= 0.5) {
            score += 42;
            signals.push(ZZ.T("全屏浮层"));
          } else if (ratio >= 0.06) {
            score += 24;
            signals.push(ZZ.T("悬浮层"));
          }
        }
        if (fixed && /none/.test(style.pointerEvents || "") && env.z >= 2000) {
          score += 10;
          signals.push(ZZ.T("高层遮罩"));
        }
      }
    }

    if (el.tagName === "A" && el.getAttribute("rel") && /sponsored/i.test(el.getAttribute("rel"))) {
      score += 26;
      signals.push("rel=sponsored");
    }

    if (score > 0 && el.hasAttribute("onclick") && /ads?|track|click/i.test(el.getAttribute("onclick"))) {
      score += 8;
      signals.push("ad onclick");
    }

    if (score <= 0) return null;
    return { score, signals, adHost, attrs };
  }

  const Detector = {
    AD_HOST_PATTERNS,
    hostIsAd,
    score,

    collect(opts) {
      return Detector.collectFromDocument(document, opts);
    },

    collectFromDocument(doc, opts) {
      const o = opts || {};
      const threshold = o.threshold || 20;
      const cap = o.cap || 30;
      const view = doc.defaultView;
      const baseUrl = (o.url || (view && view.location && view.location.href) || "https://local/").slice(0, 400);
      let baseHost = "";
      try {
        baseHost = new URL(baseUrl).hostname.toLowerCase();
      } catch (e) {
        baseHost = "";
      }
      const env = {
        view,
        doc,
        url: baseUrl,
        host: baseHost,
        vw: view ? view.innerWidth : 0,
        vh: view ? view.innerHeight : 0,
        strict: false,
      };
      let nodes;
      try {
        nodes = doc.getElementsByTagName("*");
      } catch (e) {
        return { ok: false, error: ZZ.T("无法遍历文档") };
      }
      const total = nodes.length;
      env.strict = total > 50000;
      const picked = [];
      const limit = Math.min(total, 60000);
      for (let i = 0; i < limit; i++) {
        const el = nodes[i];
        if (!el || !el.tagName || SKIP_TAGS.has(el.tagName)) continue;
        if (el.hasAttribute && el.hasAttribute("data-zz-ui")) continue;
        let res;
        try {
          res = score(el, env);
        } catch (e) {
          continue;
        }
        if (!res || res.score < threshold) continue;
        picked.push({ el, score: res.score, signals: res.signals, adHost: res.adHost });
      }

      picked.sort((a, b) => b.score - a.score);
      const kept = [];
      for (const c of picked) {
        let covered = false;
        for (const k of kept) {
          try {
            if (k.el.contains(c.el)) {
              covered = true;
              break;
            }
          } catch (e) {}
        }
        if (covered) continue;
        if (view) {
          let hidden = false;
          try {
            const style = view.getComputedStyle(c.el);
            hidden =
              style.display === "none" ||
              style.visibility === "hidden" ||
              (parseFloat(style.opacity || "1") === 0 && style.position === "fixed");
          } catch (e) {}
          if (hidden) continue;
        }
        kept.push(c);
        if (kept.length >= cap) break;
      }

      const candidates = [];
      let index = 0;
      for (const c of kept) {
        const el = c.el;
        let sel = "";
        let gen = "";
        try {
          sel = u.uniqueSelector(el, doc);
          gen = u.genericSelector(el, doc);
        } catch (e) {}
        if (!sel && !gen) continue;
        let rect = { w: 0, h: 0, x: 0, y: 0 };
        let pos = "static";
        let z = 0;
        if (view) {
          rect = u.rectOf(el);
          if (rect.w < 8 || rect.h < 8) continue;
          const style = u.styleOf(el);
          if (style) {
            pos = style.position;
            z = parseInt(style.zIndex, 10) || 0;
          }
        }
        const sel_ = sel || gen;
        if (gen && gen !== sel && u.matchCount(gen, 500, doc) > 200) gen = "";
        candidates.push({
          i: index++,
          tag: el.tagName.toLowerCase(),
          id: (el.id || "").slice(0, 60),
          cls: u.stableClasses(el).slice(0, 4),
          sel: sel_,
          gen: gen || "",
          rect,
          pos,
          z,
          text: u.textOf(el, 140),
          attrs: u.attrsOf(el, 6, env.url),
          signals: c.signals.slice(0, 6),
          score: Math.round(c.score),
          adHost: c.adHost || "",
        });
      }

      return {
        ok: true,
        url: env.url,
        title: (doc.title || "").slice(0, 160),
        scanned: limit,
        suspicious: picked.length,
        candidates,
      };
    },

    highlight(selectors, opts) {
      Detector.clearHighlight();
      const list = (selectors || []).filter((s) => u.isValidSelector(s)).slice(0, 40);
      if (!list.length) return { ok: false, error: ZZ.T("没有可高亮的元素") };
      const boxes = [];
      const scrollX = window.scrollX || 0;
      const scrollY = window.scrollY || 0;
      for (const sel of list) {
        let nodes = [];
        try {
          nodes = Array.from(document.querySelectorAll(sel)).slice(0, 3);
        } catch (e) {}
        for (const node of nodes) {
          const r = node.getBoundingClientRect();
          if (r.width < 6 || r.height < 6) continue;
          const box = document.createElement("div");
          box.className = "zz-hl-box";
          box.setAttribute("data-zz-ui", "1");
          box.style.left = r.left + scrollX + "px";
          box.style.top = r.top + scrollY + "px";
          box.style.width = r.width + "px";
          box.style.height = r.height + "px";
          document.documentElement.appendChild(box);
          boxes.push(box);
        }
      }
      if (!boxes.length) return { ok: false, error: ZZ.T("元素不可见或已移除") };
      const bar = document.createElement("div");
      bar.className = "zz-hotbar";
      bar.setAttribute("data-zz-ui", "1");
      const label = document.createElement("span");
      label.className = "zz-hotbar-text";
      label.textContent = ZZ.T("ZeroZen 发现 $1 处疑似广告", list.length);
      const applyBtn = document.createElement("button");
      applyBtn.className = "zz-hotbar-btn zz-hotbar-primary";
      applyBtn.textContent = ZZ.T("全部屏蔽");
      const reviewBtn = document.createElement("button");
      reviewBtn.className = "zz-hotbar-btn";
      reviewBtn.textContent = ZZ.T("去确认");
      const closeBtn = document.createElement("button");
      closeBtn.className = "zz-hotbar-btn zz-hotbar-close";
      closeBtn.textContent = "×";
      bar.appendChild(label);
      bar.appendChild(applyBtn);
      bar.appendChild(reviewBtn);
      bar.appendChild(closeBtn);
      document.documentElement.appendChild(bar);
      Detector._bar = bar;

      closeBtn.addEventListener("click", () => Detector.clearHighlight());
      reviewBtn.addEventListener("click", () => {
        ZZ.send({ type: "zz:options:open" });
        Detector.clearHighlight();
      });
      applyBtn.addEventListener("click", async () => {
        applyBtn.disabled = true;
        applyBtn.textContent = ZZ.T("已屏蔽");
        const items = opts && opts.items ? opts.items : list.map((sel) => ({ selector: sel }));
        await ZZ.send({
          type: "zz:findings:apply-by-selector",
          payload: { host: u.host(), items },
        });
        setTimeout(() => Detector.clearHighlight(), 600);
      });

      if (!(opts && opts.persist)) {
        setTimeout(() => Detector.clearHighlight(), 12000);
      }
      return { ok: true, count: boxes.length };
    },

    clearHighlight() {
      for (const el of Array.from(document.querySelectorAll(".zz-hl-box, .zz-hotbar"))) el.remove();
      Detector._bar = null;
    },
  };

  ZZ.Detector = Detector;
})();

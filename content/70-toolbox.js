(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u) return;
  const api = ZZ.browser;

  const NETDISK = [
    { id: "baidu", name: "百度网盘", re: /https?:\/\/(?:pan|yun)\.baidu\.com\/[^\s"'<>]+/i },
    { id: "aliyun", name: "阿里云盘", re: /https?:\/\/(?:www\.)?(?:aliyundrive|alipan)\.com\/[^\s"'<>]+/i },
    { id: "quark", name: "夸克网盘", re: /https?:\/\/pan\.quark\.cn\/[^\s"'<>]+/i },
    { id: "115", name: "115 网盘", re: /https?:\/\/(?:115|115cdn|anxia)\.com\/[^\s"'<>]+/i },
    { id: "lanzou", name: "蓝奏云", re: /https?:\/\/[a-z0-9.-]*lanzou[a-z0-9.-]*\.(?:com|cn|net)\/[^\s"'<>]+/i },
    { id: "cloud189", name: "天翼云盘", re: /https?:\/\/cloud\.189\.cn\/[^\s"'<>]+/i },
    { id: "123pan", name: "123 云盘", re: /https?:\/\/(?:www\.)?123(?:pan|684|865|912)\.com\/[^\s"'<>]+/i },
    { id: "xunlei", name: "迅雷云盘", re: /https?:\/\/pan\.xunlei\.com\/[^\s"'<>]+/i },
    { id: "weiyun", name: "腾讯微云", re: /https?:\/\/share\.weiyun\.com\/[^\s"'<>]+/i },
    { id: "ctfile", name: "城通网盘", re: /https?:\/\/(?:[a-z0-9-]+\.)?(?:ctfile|545c)\.com\/[^\s"'<>]+/i },
    { id: "onedrive", name: "OneDrive", re: /https?:\/\/1drv\.ms\/[^\s"'<>]+/i },
    { id: "gdrive", name: "Google Drive", re: /https?:\/\/drive\.google\.com\/[^\s"'<>]+/i },
    { id: "mega", name: "MEGA", re: /https?:\/\/mega\.nz\/[^\s"'<>]+/i },
    { id: "mediafire", name: "MediaFire", re: /https?:\/\/(?:www\.)?mediafire\.com\/[^\s"'<>]+/i },
    { id: "dropbox", name: "Dropbox", re: /https?:\/\/(?:www\.)?dropbox\.com\/[^\s"'<>]+/i },
  ];

  const CODE_RE = /(?:提取码|访问码|访问密码|密码|提取密码|pwd|passwd|password|code)\s*[:：=＝]?\s*([A-Za-z0-9]{2,12})/i;
  const URL_CODE_RE = /[?&](?:pwd|password|passcode|code)=([A-Za-z0-9]{2,12})/i;

  function absUrl(raw) {
    try {
      return new URL(raw, location.href).href;
    } catch (e) {
      return "";
    }
  }

  function formatOf(url, type) {
    const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url || "");
    if (m) {
      const ext = m[1].toLowerCase();
      if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp", "ico"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
      if (ext === "mp4" || ext === "webm") return ext;
    }
    if (type && /^image\//.test(type)) return type.split("/")[1].replace("jpeg", "jpg").split("+")[0];
    return "other";
  }

  function collectImages() {
    const out = new Map();
    function push(url, extra) {
      const abs = absUrl(url);
      if (!abs || /^data:/i.test(abs) || /^blob:/i.test(abs)) return;
      const prev = out.get(abs);
      if (prev) {
        Object.assign(prev, Object.fromEntries(Object.entries(extra || {}).filter(([, v]) => v)));
        return;
      }
      out.set(abs, Object.assign({ url: abs, format: formatOf(abs), w: 0, h: 0, alt: "" }, extra || {}));
    }

    for (const img of Array.from(document.images || [])) {
      let src = img.currentSrc || img.src;
      if (!src && img.srcset) {
        const cands = img.srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
        src = cands[cands.length - 1];
      }
      push(src, { w: img.naturalWidth || 0, h: img.naturalHeight || 0, alt: (img.alt || "").slice(0, 80) });
    }
    for (const pic of Array.from(document.querySelectorAll("picture source[srcset]"))) {
      const cands = pic.getAttribute("srcset").split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
      if (cands.length) push(cands[cands.length - 1], {});
    }
    for (const meta of Array.from(document.querySelectorAll("meta[property='og:image'], meta[name='twitter:image']"))) {
      const c = meta.getAttribute("content");
      if (c) push(c, { alt: "og:image" });
    }
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = a.getAttribute("href") || "";
      if (/\.(jpe?g|png|gif|webp|avif|svg)(?:[?#]|$)/i.test(href)) push(href, { alt: (a.textContent || "").trim().slice(0, 60) });
    }
    return Array.from(out.values());
  }

  function nearbyText(el) {
    const parts = [];
    let node = el;
    for (let i = 0; i < 3 && node; i++) {
      parts.push(node.textContent || "");
      node = node.parentElement;
    }
    return parts.join("\n").slice(0, 600);
  }

  // 误拦排查：列出被 ZeroZen 隐藏规则命中的元素（候选，含站点自身隐藏的），供一键放行
  function collectMisfires() {
    const css = ZZ.Css && ZZ.Css.state;
    const selectors = (css && css.hide ? css.hide : []).slice(0, 3000);
    const out = [];
    const seenEls = new Set();
    for (const sel of selectors) {
      if (!sel || out.length >= 40) break;
      let nodes = [];
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (const el of nodes) {
        if (out.length >= 40) break;
        if (!el || el === document.body || el === document.documentElement) continue;
        if (el.hasAttribute && el.hasAttribute("data-zz-ui")) continue;
        let root = el;
        for (let i = 0; i < 5 && root; i++) {
          if (seenEls.has(root)) break;
          root = root.parentElement;
        }
        if (root) continue;
        let style;
        try {
          style = window.getComputedStyle(el);
        } catch (e) {}
        if (!style || (style.display !== "none" && style.visibility !== "hidden")) continue;
        seenEls.add(el);
        const tag = el.tagName.toLowerCase();
        const id = el.id ? "#" + el.id : "";
        const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
        const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 42);
        out.push({
          selector: sel,
          summary: tag + id + cls + (text ? " 「" + text + "」" : ""),
        });
      }
    }
    return out;
  }

  function collectNetdisk() {    const found = new Map();
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    for (const a of anchors) {
      const href = a.href || "";
      for (const p of NETDISK) {
        const m = p.re.exec(href);
        if (!m) continue;
        const url = m[0].replace(/[),.;]+$/, "");
        const key = p.id + "|" + url;
        if (found.has(key)) continue;
        let code = "";
        const urlCode = URL_CODE_RE.exec(url);
        if (urlCode) code = urlCode[1];
        if (!code) {
          const ctx = nearbyText(a) + "\n" + (a.getAttribute("title") || "");
          const cm = CODE_RE.exec(ctx);
          if (cm) code = cm[1];
        }
        found.set(key, { provider: p.id, providerName: p.name, url, code, text: (a.textContent || "").trim().slice(0, 80) });
      }
    }
    const bodyText = document.body ? document.body.innerText || "" : "";
    for (const p of NETDISK) {
      const re = new RegExp(p.re.source, "gi");
      let m;
      while ((m = re.exec(bodyText))) {
        const url = m[0].replace(/[),.;]+$/, "");
        const key = p.id + "|" + url;
        if (found.has(key)) continue;
        const idx = m.index;
        const ctx = bodyText.slice(Math.max(0, idx - 120), idx + url.length + 120);
        const cm = CODE_RE.exec(ctx) || URL_CODE_RE.exec(url);
        found.set(key, { provider: p.id, providerName: p.name, url, code: cm ? cm[1] : "", text: "" });
      }
    }
    return Array.from(found.values());
  }

  function cleanNode(el) {
    const kill = "script,style,noscript,iframe,svg,form,button,input,select,textarea,nav,aside,footer,header,[role=navigation],[role=banner],[aria-hidden='true']";
    for (const n of Array.from(el.querySelectorAll(kill))) n.remove();
    for (const n of Array.from(el.querySelectorAll("*"))) {
      const cls = (n.getAttribute("class") || "") + " " + (n.id || "");
      if (/(comment|related|recommend|share|sidebar|promo|advert|ad-|ads-|sponsor|subscribe|newsletter|paywall|popup|float)/i.test(cls)) {
        n.remove();
      }
    }
    return el;
  }

  function htmlToMarkdown(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    const lines = [];
    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          const t = child.textContent.replace(/\s+/g, " ");
          if (t.trim()) lines.push(t);
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = child.tagName.toLowerCase();
        if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
          lines.push("\n" + "#".repeat(Number(tag[1])) + " " + child.textContent.trim() + "\n");
          continue;
        }
        if (tag === "p") {
          lines.push("\n" + child.textContent.trim() + "\n");
          continue;
        }
        if (tag === "br") {
          lines.push("  \n");
          continue;
        }
        if (tag === "img") {
          const src = child.getAttribute("src") || "";
          const alt = child.getAttribute("alt") || "";
          if (src) lines.push("![" + alt + "](" + src + ")\n");
          continue;
        }
        if (tag === "a") {
          const href = child.getAttribute("href") || "";
          const text = child.textContent.trim();
          if (text) lines.push("[" + text + "](" + href + ")");
          continue;
        }
        if (tag === "li") {
          lines.push("- " + child.textContent.trim());
          continue;
        }
        if (tag === "blockquote") {
          lines.push("\n> " + child.textContent.trim() + "\n");
          continue;
        }
        if (tag === "pre" || tag === "code") {
          lines.push("\n```\n" + child.textContent.trim() + "\n```\n");
          continue;
        }
        walk(child);
      }
    };
    walk(div);
    return lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function stripSiteName(title) {
    let t = String(title || "").trim();
    if (!t) return t;
    const hostBrand = location.hostname.replace(/^www\./, "").split(".")[0].toLowerCase();
    const parts = t.split(/\s*[-–—_|｜]\s*/);
    if (parts.length > 1) {
      const last = parts[parts.length - 1].trim();
      const drop =
        last.length <= 16 &&
        (last.toLowerCase().includes(hostBrand) ||
          /^(youtube|bilibili|哔哩哔哩|西瓜视频|腾讯视频|爱奇艺|优酷|芒果|抖音|快手|微博|知乎|豆瓣|小红书|csdn|掘金|博客园|github|twitter|x|facebook|instagram|reddit|linkedin|twitch|vimeo|dailymotion|netflix|spotify|soundcloud)$/i.test(last));
      if (drop) return parts.slice(0, -1).join(" - ").trim();
    }
    return t;
  }

  function extractArticle() {
    const candidates = Array.from(document.querySelectorAll("article, main, [role=main], .article, .post, .content, #content, .entry-content, .post-content"));
    let best = null;
    let bestScore = 0;
    for (const el of candidates.slice(0, 40)) {
      const ps = el.querySelectorAll("p");
      let score = 0;
      for (const p of Array.from(ps).slice(0, 80)) score += Math.min(400, (p.textContent || "").trim().length);
      score += Math.min(2000, ((el.textContent || "").length / 20) | 0);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) {
      const divs = Array.from(document.querySelectorAll("div, section")).slice(0, 800);
      for (const el of divs) {
        const ps = el.querySelectorAll("p");
        if (ps.length < 3) continue;
        let score = 0;
        for (const p of Array.from(ps).slice(0, 60)) score += Math.min(400, (p.textContent || "").trim().length);
        const density = score / Math.max(1, el.textContent.length);
        if (density > 0.5 && score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
    }
    if (!best) return { ok: false, error: ZZ.T("未找到正文内容") };
    const clone = cleanNode(best.cloneNode(true));
    const text = (clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
    return {
      ok: true,
      title: stripSiteName(document.title),
      url: location.href,
      html: clone.innerHTML,
      text,
      length: text.length,
    };
  }

  const clean = { active: false, style: null };

  const CLEAN_CSS = [
    "header,footer,nav,aside,[role=navigation],[role=banner],[role=complementary]{display:none!important}",
    "[class*='sidebar'],[class*='side-bar'],[class*='comment'],[class*='related'],[class*='recommend']{display:none!important}",
    "[class*='share'],[class*='subscribe'],[class*='newsletter'],[class*='cookie'],[class*='consent']{display:none!important}",
    "[class*='popup'],[class*='float'],[class*='sticky'],[class*='backtop'],[class*='back-top']{display:none!important}",
    "[class*='advert'],[class*='sponsor'],[class*='banner-ad'],[class*='ad-slot']{display:none!important}",
    "article,main,[role=main],.article,.post,.content{max-width:860px!important;margin:0 auto!important;line-height:1.8!important;font-size:17px!important}",
    "body{background:#fafafa!important}",
  ].join("\n");

  function toggleClean(force) {
    const want = typeof force === "boolean" ? force : !clean.active;
    if (want === clean.active) return { active: clean.active };
    if (want) {
      const style = document.createElement("style");
      style.setAttribute("data-zz-clean", "1");
      style.textContent = CLEAN_CSS;
      (document.head || document.documentElement).appendChild(style);
      clean.style = style;
      clean.active = true;
    } else {
      if (clean.style) clean.style.remove();
      clean.style = null;
      clean.active = false;
    }
    return { active: clean.active };
  }

  // ---------- 阅读模式 ----------
  const reader = { host: null };

  function exitReader() {
    if (reader.host) {
      reader.host.remove();
      reader.host = null;
    }
    if (ZZ.FX && ZZ.FX.readerOut) ZZ.FX.readerOut();
    document.documentElement.style.removeProperty("overflow");
  }

  const READER_THEMES = ["light", "sepia", "dark", "gray"];

  function safeName(name) {
    return String(name || "article")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "article";
  }

  // 深度净化正文：只保留语义标签与白名单属性。
  // 页面 CSS 进不来 shadow DOM，但 inline style 属性能进来——这是「样式去不干净」的根源，全部剥离。
  function sanitizeArticleHtml(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html || "");
    tpl.content
      .querySelectorAll(
        "script,style,noscript,iframe,frame,object,embed,svg,form,button,input,select,textarea,video,audio,canvas,map,area,link,meta"
      )
      .forEach((el) => el.remove());
    const KEEP = new Set([
      "P","H1","H2","H3","H4","H5","H6","UL","OL","LI","BLOCKQUOTE","PRE","CODE","TABLE","THEAD","TBODY","TFOOT",
      "TR","TD","TH","A","IMG","STRONG","B","EM","I","U","S","DEL","BR","HR","FIGURE","FIGCAPTION","SUP","SUB",
      "DL","DT","DD","CITE","Q","MARK","SMALL",
    ]);
    const unwrapChildren = (node) => {
      let changed = true;
      while (changed) {
        changed = false;
        for (const child of Array.from(node.children)) {
          if (!KEEP.has(child.tagName)) {
            const frag = document.createDocumentFragment();
            while (child.firstChild) frag.appendChild(child.firstChild);
            child.replaceWith(frag);
            changed = true;
            break;
          }
        }
      }
    };
    const roots = [tpl.content];
    while (roots.length) {
      const node = roots.pop();
      unwrapChildren(node);
      for (const child of Array.from(node.children)) {
        const tag = child.tagName;
        for (const a of Array.from(child.attributes)) {
          const n = a.name.toLowerCase();
          const ok =
            (tag === "A" && n === "href") ||
            (tag === "IMG" && (n === "src" || n === "alt")) ||
            ((tag === "TD" || tag === "TH") && (n === "colspan" || n === "rowspan"));
          if (!ok) child.removeAttribute(a.name);
        }
        if (tag === "IMG") {
          if (!/^https?:/i.test(child.getAttribute("src") || "")) {
            const lazy =
              child.getAttribute("data-src") ||
              child.getAttribute("data-original") ||
              child.getAttribute("data-lazy-src") ||
              "";
            if (lazy) {
              try {
                child.setAttribute("src", new URL(lazy, location.href).href);
              } catch (e) {}
            }
          }
          try {
            const s = child.getAttribute("src");
            if (s) child.setAttribute("src", new URL(s, location.href).href);
          } catch (e) {}
          if (!/^https?:/i.test(child.getAttribute("src") || "")) {
            child.remove();
            continue;
          }
        } else if (tag === "A") {
          try {
            const h = child.getAttribute("href");
            if (h && !h.startsWith("#")) child.setAttribute("href", new URL(h, location.href).href);
          } catch (e) {}
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noreferrer");
        }
        roots.push(child);
      }
    }
    tpl.content.querySelectorAll("p").forEach((p) => {
      if (!p.textContent.trim() && !p.querySelector("img")) p.remove();
    });
    return tpl.innerHTML;
  }

  const READER_THEME_STYLE = {
    light: "background:#ffffff;color:#1f2328",
    sepia: "background:#f4ecd8;color:#433422",
    dark: "background:#0d1117;color:#c9d1d9",
    gray: "background:#e7e8ea;color:#2b2f33",
  };

  // 独立 HTML 导出：自带主题样式，双击即可阅读
  function standaloneHtml(title, cleanHtml, theme) {
    const bodyStyle = READER_THEME_STYLE[theme] || READER_THEME_STYLE.light;
    const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return (
      "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" +
      esc(title) +
      "</title><style>body{" + bodyStyle +
      ";max-width:760px;margin:0 auto;padding:40px 20px;font:17px/1.85 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif}" +
      "img{max-width:100%;height:auto}pre{background:rgba(127,127,127,.12);padding:12px;border-radius:8px;overflow:auto}" +
      "blockquote{border-left:3px solid rgba(127,127,127,.4);margin:12px 0;padding:4px 12px;opacity:.85}a{color:#3b82f6}" +
      "table{border-collapse:collapse}td,th{border:1px solid rgba(127,127,127,.35);padding:4px 8px}h1{font-size:26px;line-height:1.35}</style></head><body><h1>" +
      esc(title) +
      "</h1><p><small>" +
      esc(location.hostname) + " · " + esc(location.href) +
      "</small></p>" + cleanHtml + "</body></html>"
    );
  }

  // 页面级下载兜底：不依赖 downloads 权限（存到浏览器默认下载目录，无 ZeroZen/ 子目录）
  function pageDownload(text, mime, filename) {
    try {
      const blob = new Blob([text], { type: mime + ";charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 60000);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function saveArticle(payload, fallback) {
    const res = await ZZ.send({ type: "zz:toolbox:save-article", payload });
    if (res && res.ok) return { ok: true, filename: res.filename };
    if (fallback && pageDownload(fallback.text, fallback.mime, fallback.filename)) {
      return { ok: true, filename: fallback.filename + "（" + ZZ.T("浏览器下载目录") + "）" };
    }
    return { ok: false, error: (res && res.error) || ZZ.T("保存失败") };
  }

  function enterReader(article) {
    exitReader();
    const cleanHtml = sanitizeArticleHtml(article.html);
    const mdText =
      "# " + (article.title || document.title) + "\n\n> " + ZZ.T("来源：$1", location.href) + "\n\n" + htmlToMarkdown(cleanHtml);
    const htmlText = () => standaloneHtml(article.title || document.title, cleanHtml, reader.theme || "light");
    const mount = async () => {
      const host = document.createElement("div");
      host.setAttribute("data-zz-ui", "1");
      host.style.cssText = "position:fixed;inset:0;z-index:2147483600;overflow:auto;";
      const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
      const styles = document.createElement("style");
      styles.textContent =
        ":host{all:initial}*{box-sizing:border-box}" +
        ".t{min-height:100%;background:var(--bg);color:var(--fg)}" +
        ".t-light{--bg:#ffffff;--fg:#1f2328;--muted:#8b949e;--line:#eaeef2;--pre:#f6f8fa;--bq:#57606a;--bd:#d0d7de;--accent:#3b82f6;--btnbg:#ffffff}" +
        ".t-sepia{--bg:#f4ecd8;--fg:#433422;--muted:#8a7a5f;--line:#e0d5b8;--pre:#ece1c4;--bq:#6b5a3e;--bd:#c9b98f;--accent:#b4690e;--btnbg:#faf3e0}" +
        ".t-dark{--bg:#0d1117;--fg:#c9d1d9;--muted:#8b949e;--line:#21262d;--pre:#161b22;--bq:#8b949e;--bd:#30363d;--accent:#58a6ff;--btnbg:#161b22}" +
        ".t-gray{--bg:#e7e8ea;--fg:#2b2f33;--muted:#6c757d;--line:#d5d7da;--pre:#dfe1e4;--bq:#495057;--bd:#b9bdc2;--accent:#0b6bcb;--btnbg:#f3f4f6}" +
        ".wrap{max-width:760px;margin:0 auto;padding:64px 20px 80px;font:var(--fs,17px)/1.85 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif}" +
        "h1{font-size:1.55em;line-height:1.35;margin:0 0 8px}.meta{color:var(--muted);font-size:12px;margin-bottom:18px}" +
        ".bar{position:sticky;top:0;display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 14px;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);z-index:2}" +
        "button{font:inherit;font-size:13px;padding:4px 10px;border-radius:8px;border:1px solid var(--bd);background:var(--btnbg);color:var(--fg);cursor:pointer}" +
        "button.primary{background:var(--accent);border-color:var(--accent);color:#fff}" +
        "button:disabled{opacity:.55;cursor:default}" +
        ".pay{font-size:12px;color:var(--muted);margin-right:auto;align-self:center}.pay a{color:var(--accent)}" +
        ".body{font-size:var(--fs,17px)}" +
        "img{max-width:100%;height:auto;border-radius:4px}pre{background:var(--pre);padding:12px;border-radius:8px;overflow:auto}" +
        "blockquote{border-left:3px solid var(--bd);margin:12px 0;padding:4px 12px;color:var(--bq)}" +
        "a{color:var(--accent)}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid var(--bd);padding:4px 8px}" +
        "h2,h3,h4{line-height:1.4;margin:1.4em 0 .5em}";
      root.appendChild(styles);
      const themeWrap = document.createElement("div");
      themeWrap.className = "t t-light";
      root.appendChild(themeWrap);
      const bar = document.createElement("div");
      bar.className = "bar";
      const pay = document.createElement("span");
      pay.className = "pay";
      pay.innerHTML = ZZ.T("阅读模式采用<b>诚实付费</b>：觉得好用请支持作者");
      bar.appendChild(pay);

      // 主题与字号：从设置恢复，切换时写回
      let theme = "light";
      let font = 17;
      try {
        const s = await ZZ.send({ type: "zz:settings:get" });
        const r = s && s.ok && s.settings && s.settings.toolbox && s.settings.toolbox.reader;
        if (r) {
          if (READER_THEMES.indexOf(r.theme) >= 0) theme = r.theme;
          if (r.font >= 13 && r.font <= 26) font = r.font;
        }
      } catch (e) {}
      reader.theme = theme;
      const persistReader = () => {
        ZZ.send({ type: "zz:settings:set", payload: { settings: { toolbox: { reader: { theme, font } } }, rebuild: false } });
      };
      const applyLook = () => {
        themeWrap.className = "t t-" + theme;
        themeWrap.style.setProperty("--fs", font + "px");
      };
      applyLook();

      const themeBtn = document.createElement("button");
      const themeNames = { light: ZZ.T("浅色"), sepia: ZZ.T("羊皮纸"), dark: ZZ.T("深色"), gray: ZZ.T("灰色") };
      const themeLabel = () => ZZ.T("主题：$1", themeNames[theme]);
      themeBtn.textContent = themeLabel();
      themeBtn.addEventListener("click", () => {
        theme = READER_THEMES[(READER_THEMES.indexOf(theme) + 1) % READER_THEMES.length];
        reader.theme = theme;
        applyLook();
        themeBtn.textContent = themeLabel();
        persistReader();
      });
      const fontMinus = document.createElement("button");
      fontMinus.textContent = "A−";
      const fontPlus = document.createElement("button");
      fontPlus.textContent = "A+";
      const bumpFont = (d) => {
        font = Math.max(13, Math.min(26, font + d));
        applyLook();
        persistReader();
      };
      fontMinus.addEventListener("click", () => bumpFont(-1));
      fontPlus.addEventListener("click", () => bumpFont(1));
      bar.appendChild(themeBtn);
      bar.appendChild(fontMinus);
      bar.appendChild(fontPlus);

      // 翻译：按块送后台机翻，可一键译回原文
      let translated = false;
      const transPairs = new Map();
      const translateBtn = document.createElement("button");
      translateBtn.textContent = ZZ.T("翻译");
      const noticeInline = (text) => ZZ.notice(text);
      translateBtn.addEventListener("click", async () => {
        if (translated) {
          for (const [el, text] of transPairs) el.textContent = text;
          transPairs.clear();
          translated = false;
          translateBtn.textContent = ZZ.T("翻译");
          return;
        }
        const BLOCK_SEL = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dd,dt,td,th";
        const blocks = Array.from(body.querySelectorAll(BLOCK_SEL)).filter((el) => {
          if (el.querySelector(BLOCK_SEL) || el.querySelector("pre")) return false;
          const t = (el.textContent || "").trim();
          return t.length >= 2 && t.length <= 4000;
        });
        let total = 0;
        const picked = [];
        for (const el of blocks) {
          const t = el.textContent.trim();
          if (total + t.length > 30000 || picked.length >= 200) break;
          total += t.length;
          picked.push({ el, text: t });
        }
        if (!picked.length) {
          noticeInline(ZZ.T("没有可翻译的正文"));
          return;
        }
        const target = ZZ.I18n && ZZ.I18n.lang() === "en" ? "en" : "zh-CN";
        let cjk = 0;
        for (const p of picked) cjk += (p.text.match(/[\u4e00-\u9fff]/g) || []).length;
        if (target === "zh-CN" && cjk / total > 0.25) {
          noticeInline(ZZ.T("正文已是中文，无需翻译"));
          return;
        }
        translateBtn.disabled = true;
        translateBtn.textContent = ZZ.T("翻译中…");
        const res = await ZZ.send({ type: "zz:reader:translate", payload: { texts: picked.map((p) => p.text), target } });
        translateBtn.disabled = false;
        if (!res || !res.ok || !res.items) {
          translateBtn.textContent = ZZ.T("翻译");
          noticeInline(ZZ.T("翻译失败：$1", (res && res.error) || ZZ.T("无法访问翻译服务")));
          return;
        }
        let applied = 0;
        for (let i = 0; i < picked.length; i++) {
          if (res.items[i] && String(res.items[i]).trim()) {
            transPairs.set(picked[i].el, picked[i].text);
            picked[i].el.textContent = res.items[i];
            applied++;
          }
        }
        translated = applied > 0;
        translateBtn.textContent = translated ? ZZ.T("译回原文") : ZZ.T("翻译");
        noticeInline(ZZ.T("已翻译 $1 段（$2）", applied, res.engine === "ai" ? ZZ.T("AI 翻译") : ZZ.T("机器翻译")));
      });
      bar.appendChild(translateBtn);

      const saveBtn = document.createElement("button");
      saveBtn.className = "primary";
      saveBtn.textContent = ZZ.T("保存 Markdown");
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        const r = await saveArticle(
          { title: article.title || document.title, markdown: mdText, url: location.href, ext: "md" },
          { text: mdText, mime: "text/markdown", filename: safeName(article.title || document.title) + ".md" }
        );
        saveBtn.disabled = false;
        noticeInline(r.ok ? ZZ.T("已保存：$1", r.filename) : ZZ.T("保存失败：$1", r.error || ZZ.T("未知错误")));
      });
      const saveHtmlBtn = document.createElement("button");
      saveHtmlBtn.textContent = ZZ.T("存为 HTML");
      saveHtmlBtn.addEventListener("click", async () => {
        saveHtmlBtn.disabled = true;
        const r = await saveArticle(
          { title: article.title || document.title, html: htmlText(), url: location.href, ext: "html" },
          { text: htmlText(), mime: "text/html", filename: safeName(article.title || document.title) + ".html" }
        );
        saveHtmlBtn.disabled = false;
        noticeInline(r.ok ? ZZ.T("已保存：$1", r.filename) : ZZ.T("保存失败：$1", r.error || ZZ.T("未知错误")));
      });
      const exitBtn = document.createElement("button");
      exitBtn.textContent = ZZ.T("退出阅读模式");
      bar.appendChild(saveBtn);
      bar.appendChild(saveHtmlBtn);
      bar.appendChild(exitBtn);
      themeWrap.appendChild(bar);
      const wrap = document.createElement("div");
      wrap.className = "wrap";
      const h1 = document.createElement("h1");
      h1.textContent = article.title || document.title;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = location.hostname + " · " + ZZ.T("已提取 $1 字", article.length);
      const body = document.createElement("div");
      body.className = "body";
      body.innerHTML = cleanHtml;
      wrap.appendChild(h1);
      wrap.appendChild(meta);
      wrap.appendChild(body);
      themeWrap.appendChild(wrap);
      (document.body || document.documentElement).appendChild(host);
      document.documentElement.style.setProperty("overflow", "hidden");
      reader.host = host;
      exitBtn.addEventListener("click", exitReader);
    };
    if (ZZ.FX && ZZ.FX.readerIn) {
      ZZ.FX.readerIn(mount);
    } else {
      mount();
    }
    return { ok: true, length: article.length };
  }

  function collectStreams() {
    const out = new Map();
    function push(url, note) {
      const abs = absUrl(url);
      if (!abs || !/^https?:/i.test(abs)) return;
      if (!/\.(m3u8|mp4|webm|mpd)(\?|#|$)/i.test(abs) && !/m3u8|\/hls\/|playlist/i.test(abs)) return;
      if (!out.has(abs)) out.set(abs, { url: abs, note: note || "", kind: /m3u8|\/hls\//i.test(abs) ? "m3u8" : /mpd/i.test(abs) ? "mpd" : "media" });
    }
    for (const v of Array.from(document.querySelectorAll("video, audio"))) {
      push(v.currentSrc || v.src, ZZ.T("媒体元素"));
      if (v.dataset) {
        push(v.dataset.src || "", "data-src");
        push(v.dataset.hls || v.dataset.m3u8 || "", "data-hls");
      }
      for (const s of Array.from(v.querySelectorAll("source"))) push(s.src || s.getAttribute("src"), "source");
    }
    // 页面链接与 iframe：未播放也能发现（如站点直接给出 m3u8/mp4 地址）
    try {
      for (const a of Array.from(document.querySelectorAll("a[href]"))) push(a.getAttribute("href"), ZZ.T("页面链接"));
      for (const f of Array.from(document.querySelectorAll("iframe[src], embed[src]"))) push(f.getAttribute("src"), ZZ.T("内嵌页面"));
      for (const s of Array.from(document.querySelectorAll("source[src], track[src]"))) push(s.getAttribute("src"), "source");
    } catch (e) {}
    // data-* 属性：懒加载播放器常把流地址放在 data-url / data-video 等属性里
    try {
      for (const el of Array.from(document.querySelectorAll("[data-src],[data-url],[data-video],[data-hls],[data-m3u8],[data-mp4],[data-file],[data-stream],[data-source]"))) {
        for (const attr of el.attributes) {
          if (/^data-(src|url|video|hls|m3u8|mp4|file|stream|source)$/i.test(attr.name)) push(attr.value, attr.name);
        }
      }
    } catch (e) {}
    try {
      for (const e of performance.getEntriesByType("resource") || []) {
        if (/\.m3u8|m3u8|\/hls\//i.test(e.name)) push(e.name, ZZ.T("网络请求"));
      }
    } catch (e) {}
    const re = /https?:\/\/[^"'\\\s<>]+?(?:\.m3u8|\.mpd|\.mp4|\/hls\/)[^"'\\\s<>]*/gi;
    try {
      for (const script of Array.from(document.scripts || []).slice(0, 40)) {
        const text = script.textContent || "";
        if (!text || text.length > 400000) continue;
        let m;
        const local = new RegExp(re);
        while ((m = local.exec(text))) push(m[0].replace(/[),.;]+$/, ""), ZZ.T("页面脚本"));
      }
    } catch (e) {}
    try {
      const html = document.documentElement ? document.documentElement.innerHTML.slice(0, 250000) : "";
      let m;
      const local = new RegExp(re);
      while ((m = local.exec(html))) push(m[0].replace(/[),.;]+$/, ""), ZZ.T("页面源码"));
    } catch (e) {}
    return Array.from(out.values());
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    if (msg.type === "zz:toolbox:streams") {
      sendResponse({ ok: true, streams: collectStreams() });
      return false;
    }
    if (msg.type === "zz:toolbox:images") {
      sendResponse({ ok: true, images: collectImages(), title: stripSiteName(document.title), host: location.hostname });
      return false;
    }
    if (msg.type === "zz:toolbox:netdisk") {
      sendResponse({ ok: true, links: collectNetdisk() });
      return false;
    }
    if (msg.type === "zz:toolbox:article") {
      const art = extractArticle();
      sendResponse(art.ok ? { ok: true, article: { title: art.title, html: art.html, text: art.text, length: art.length, url: art.url } } : art);
      return false;
    }
    if (msg.type === "zz:toolbox:misfires") {
      sendResponse({ ok: true, misfires: collectMisfires(), host: location.hostname });
      return false;
    }
    if (msg.type === "zz:reader:toggle") {
      if (reader.host) {
        exitReader();
        sendResponse({ ok: true, active: false });
        return false;
      }
      const art = extractArticle();
      if (!art.ok) {
        sendResponse(art);
        return false;
      }
      const res = enterReader(art);
      sendResponse({ ok: true, active: true, length: res.length });
      return false;
    }
    if (msg.type === "zz:reader:exit") {
      exitReader();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === "zz:clean:toggle") {
      sendResponse(Object.assign({ ok: true }, toggleClean(msg.payload && msg.payload.active)));
      return false;
    }
    return false;
  });
})();

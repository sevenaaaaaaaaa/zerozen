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

  function collectNetdisk() {
    const found = new Map();
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
    if (!best) return { ok: false, error: "未找到正文内容" };
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

  const reader = { host: null };

  function exitReader() {
    if (reader.host) {
      reader.host.remove();
      reader.host = null;
    }
    document.documentElement.style.removeProperty("overflow");
  }

  function enterReader(article) {
    exitReader();
    const host = document.createElement("div");
    host.setAttribute("data-zz-ui", "1");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:#fff;color:#1f2328;overflow:auto;";
    const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    const styles = document.createElement("style");
    styles.textContent =
      ":host{all:initial}*{box-sizing:border-box}" +
      ".wrap{max-width:760px;margin:0 auto;padding:36px 20px 80px;font:17px/1.85 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2328}" +
      "h1{font-size:26px;line-height:1.35;margin:0 0 8px}.meta{color:#8b949e;font-size:12px;margin-bottom:18px}" +
      ".bar{position:fixed;top:0;left:0;right:0;display:flex;gap:8px;justify-content:flex-end;padding:10px 16px;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);border-bottom:1px solid #eaeef2;z-index:2}" +
      "button{font:inherit;font-size:13px;padding:5px 12px;border-radius:8px;border:1px solid #d0d7de;background:#fff;cursor:pointer}" +
      "button.primary{background:#3b82f6;border-color:#3b82f6;color:#fff}" +
      ".pay{font-size:12px;color:#8b949e;margin-right:auto;align-self:center}.pay a{color:#3b82f6}" +
      "img{max-width:100%;height:auto}pre{background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto}blockquote{border-left:3px solid #d0d7de;margin:12px 0;padding:4px 12px;color:#57606a}";
    root.appendChild(styles);
    const bar = document.createElement("div");
    bar.className = "bar";
    const pay = document.createElement("span");
    pay.className = "pay";
    pay.innerHTML = "阅读模式采用<b>诚实付费</b>：觉得好用请支持作者";
    bar.appendChild(pay);
    const saveBtn = document.createElement("button");
    saveBtn.className = "primary";
    saveBtn.textContent = "保存到本地";
    const exitBtn = document.createElement("button");
    exitBtn.textContent = "退出阅读模式";
    bar.appendChild(saveBtn);
    bar.appendChild(exitBtn);
    root.appendChild(bar);
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    const h1 = document.createElement("h1");
    h1.textContent = article.title || document.title;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = location.hostname + " · 已提取 " + article.length + " 字";
    const body = document.createElement("div");
    body.innerHTML = article.html;
    wrap.appendChild(h1);
    wrap.appendChild(meta);
    wrap.appendChild(body);
    root.appendChild(wrap);
    (document.body || document.documentElement).appendChild(host);
    document.documentElement.style.setProperty("overflow", "hidden");
    reader.host = host;

    exitBtn.addEventListener("click", exitReader);
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "保存中…";
      const md = "# " + (article.title || document.title) + "\n\n> 来源：" + location.href + "\n\n" + htmlToMarkdown(article.html);
      const res = await ZZ.send({
        type: "zz:toolbox:save-article",
        payload: { title: article.title || document.title, markdown: md, url: location.href },
      });
      saveBtn.disabled = false;
      saveBtn.textContent = "保存到本地";
      ZZ.notice(res && res.ok ? "已保存：" + (res.filename || "") : "保存失败：" + ((res && res.error) || "未知错误"));
    });
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
      push(v.currentSrc || v.src, "媒体元素");
      if (v.dataset) {
        push(v.dataset.src || "", "data-src");
        push(v.dataset.hls || v.dataset.m3u8 || "", "data-hls");
      }
      for (const s of Array.from(v.querySelectorAll("source"))) push(s.src || s.getAttribute("src"), "source");
    }
    try {
      for (const e of performance.getEntriesByType("resource") || []) {
        if (/\.m3u8|m3u8|\/hls\//i.test(e.name)) push(e.name, "网络请求");
      }
    } catch (e) {}
    const re = /https?:\/\/[^"'\\\s<>]+?(?:\.m3u8|\/hls\/)[^"'\\\s<>]*/gi;
    try {
      for (const script of Array.from(document.scripts || []).slice(0, 40)) {
        const text = script.textContent || "";
        if (!text || text.length > 400000) continue;
        let m;
        const local = new RegExp(re);
        while ((m = local.exec(text))) push(m[0].replace(/[),.;]+$/, ""), "页面脚本");
      }
    } catch (e) {}
    try {
      const html = document.documentElement ? document.documentElement.innerHTML.slice(0, 250000) : "";
      let m;
      const local = new RegExp(re);
      while ((m = local.exec(html))) push(m[0].replace(/[),.;]+$/, ""), "页面源码");
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

// 下载引擎：HLS（m3u8）分片下载 / AES-128 解密 / TS→MP4 转封装 / 断点续传 / 直播录制。
// 运行在常驻下载宿主（ui/dl-host.html：Chrome 为 offscreen 文档，Firefox 为后台页内嵌帧），
// 不再依赖 popup 或工具箱标签页的生命周期。纯工具函数（命名、分类、错误分析）也供各 UI 页面复用。
//
// 依赖：ZZDLStore（IndexedDB 分片存储）；可选 muxjs（ui/vendor/mux.min.js，TS→MP4）。
// 宿主通过 ZZDLEngine.init({ T, spoof, unspoof }) 注入 Referer 伪装能力。
(function () {
  let T = (s, ...subs) => String(s).replace(/\$(\d+)/g, (m, i) => (subs[i - 1] === undefined ? "" : subs[i - 1]));
  let spoofHook = null; // async (url, referrer) => token
  let unspoofHook = null; // (token) => void

  function init(opts) {
    if (!opts) return;
    if (opts.T) T = opts.T;
    if (opts.spoof) spoofHook = opts.spoof;
    if (opts.unspoof) unspoofHook = opts.unspoof;
  }

  // ---------------- 通用工具 ----------------

  function sanitize(name) {
    return (
      String(name || "download")
        .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
        .replace(/[​-‏‪-‮]/g, "")
        .replace(/\s+/g, " ")
        .replace(/^[.\s]+|[.\s]+$/g, "")
        .trim()
        .slice(0, 120) || "download"
    );
  }

  const SITE_SUFFIX_RE =
    /^(youtube|bilibili|哔哩哔哩|哔哩哔哩_bilibili|腾讯视频|爱奇艺|优酷|芒果tv|芒果|抖音|快手|微博|知乎|西瓜视频|好看视频|csdn|github|x|twitter|facebook|reddit|twitch|vimeo|netflix|tiktok|instagram|在线观看|在线播放|高清在线观看|免费在线观看|视频|官网|首页)$/i;

  // 页面标题 → 干净的文件名：去掉「 - 站点名」「_哔哩哔哩」「| 在线观看」这类尾巴
  function titleToName(title, pageUrl) {
    let t = String(title || "").replace(/\s+/g, " ").trim();
    let brand = "";
    try {
      brand = new URL(pageUrl).hostname.replace(/^(www|m)\./, "").split(".")[0].toLowerCase();
    } catch (e) {}
    for (let i = 0; i < 3; i++) {
      const m = t.match(/^(.*\S)\s*[-–—_|｜·]\s*([^-–—_|｜·]{1,24})$/);
      if (!m || m[1].length < 2) break;
      const tail = m[2].trim().toLowerCase();
      if (SITE_SUFFIX_RE.test(tail) || (brand && tail.replace(/\s+/g, "").includes(brand)) || /在线|观看|播放|官网|免费|高清/.test(tail)) {
        t = m[1].trim();
      } else break;
    }
    return sanitize(t || "video");
  }

  function nameFromUrl(url) {
    try {
      const u = new URL(url);
      const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
      return sanitize(last.replace(/\.(m3u8|mpd)$/i, "") || u.hostname);
    } catch (e) {
      return "download";
    }
  }

  function extOf(nameOrUrl) {
    const m = String(nameOrUrl || "").split(/[?#]/)[0].match(/\.([a-z0-9]{1,5})$/i);
    return m ? m[1].toLowerCase() : "";
  }

  function classifyExt(nameOrUrl) {
    const ext = extOf(nameOrUrl);
    if (/^(mp4|ts|webm|mkv|avi|mov|flv|m4v|m3u8|mpd)$/.test(ext)) return "video";
    if (/^(mp3|m4a|flac|wav|aac|ogg|opus)$/.test(ext)) return "audio";
    if (/^(jpg|jpeg|png|gif|webp|avif|bmp|svg|ico)$/.test(ext)) return "image";
    if (/^(zip|rar|7z|tar|gz|bz2|xz|apk|dmg|iso)$/.test(ext)) return "archive";
    if (/^(pdf|doc|docx|xls|xlsx|ppt|pptx|epub|mobi|txt|md|csv)$/.test(ext)) return "doc";
    return "other";
  }

  function dirForType(cat, dirs) {
    const d = dirs || {};
    const fallback = {
      video: "ZeroZen/视频",
      audio: "ZeroZen/音频",
      image: "ZeroZen/图片",
      archive: "ZeroZen/压缩包",
      doc: "ZeroZen/文档",
      other: "ZeroZen/下载",
    };
    return String(d[cat] || fallback[cat] || "ZeroZen/下载").replace(/\/+$/, "");
  }

  function bytes(n) {
    if (n === undefined || n === null || Number.isNaN(n)) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = Number(n);
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return v.toFixed(i ? 1 : 0) + " " + units[i];
  }

  function duration(sec) {
    if (!sec || !isFinite(sec)) return "";
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  }

  function throttle(fn, ms) {
    let last = 0;
    let timer = null;
    const wrapped = (...args) => {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn(...args);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          fn(...args);
        }, ms - (now - last));
      }
    };
    wrapped.cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    return wrapped;
  }

  // 失败原因 → { reason, advice }：浏览器下载错误码与引擎错误统一解释
  function errorHint(err) {
    const raw = String((err && (err.error || err.message)) || err || "").trim();
    const code = String((err && err.error) || "").trim();
    const map = {
      FILE_FAILED: [T("本地写入失败"), T("磁盘空间不足或文件被占用；清理空间或更换保存目录后重试")],
      FILE_ACCESS_DENIED: [T("无写入权限"), T("下载目录不可写；在系统设置中检查浏览器的文件访问权限")],
      FILE_NO_SPACE: [T("磁盘空间不足"), T("清理磁盘空间后重试")],
      FILE_NAME_TOO_LONG: [T("文件名过长"), T("换一个更短的文件名")],
      NETWORK_TIMEOUT: [T("连接超时"), T("网络不稳定或服务器响应慢；点「重试」会从断点继续")],
      NETWORK_FAILED: [T("网络错误"), T("连接被重置或 DNS 解析失败；检查网络/代理后点「重试」")],
      NETWORK_INVALID_REQUEST: [T("请求无效"), T("链接可能已过期或需要登录；回到原页面重新播放后再下载")],
      SERVER_BAD_CONTENT: [T("服务器返回 404"), T("文件不存在或链接已失效；回到原页面重新播放后再下载")],
      SERVER_FORBIDDEN: [T("服务器返回 403"), T("服务器拒绝访问（防盗链/需登录/限流）；回到原页面重新播放后再下载")],
      SERVER_UNAUTHORIZED: [T("服务器返回 401"), T("需要登录；在浏览器登录该站点后重试")],
      SERVER_FAILED: [T("服务器错误（5xx）"), T("服务器临时故障；稍后点「重试」")],
      SERVER_CONTENT_LENGTH_MISMATCH: [T("数据不完整"), T("服务器传输中断；点「重试」")],
      SERVER_CROSS_ORIGIN_REDIRECT: [T("跨域重定向被拒"), T("回到原页面重新获取地址")],
      USER_CANCELED: [T("已取消"), ""],
      CRASH: [T("浏览器崩溃"), T("重启浏览器后点「重试」")],
    };
    if (code && map[code]) return { reason: map[code][0], advice: map[code][1], raw };
    if (/DRM|SAMPLE-AES/i.test(raw)) return { reason: raw, advice: T("加密受版权保护（DRM），无法离线保存"), raw };
    if (/HTTP 40[134]|HTTP 410/.test(raw))
      return { reason: raw, advice: T("链接已失效或被防盗链拦截；回到原页面重新播放一下，再从弹窗里下载（已下分片会保留）"), raw };
    if (/downloads|下载权限|权限/.test(raw)) return { reason: raw, advice: T("需要授予「下载」权限：在弹窗或下载中心点一次下载按钮即可授权"), raw };
    if (/HTTP|网络|timeout|超时|Failed to fetch|NetworkError/i.test(raw))
      return { reason: raw, advice: T("网络不稳定；点「重试」会从断点继续"), raw };
    return { reason: raw || T("未知错误"), advice: "", raw };
  }

  function buildReport(item, extra) {
    let version = "?";
    try {
      version = globalThis.ZZ.browser.runtime.getManifest().version;
    } catch (e) {}
    const hint = item.hint || (item.error ? errorHint({ message: item.error }) : null);
    const lines = [
      "- " + T("扩展版本") + ": ZeroZen " + version,
      "- " + T("时间") + ": " + new Date().toISOString(),
      "- " + T("下载地址") + ": " + (item.url || "-"),
      "- " + T("来源页面") + ": " + (item.pageUrl || "-"),
      "- " + T("文件名") + ": " + (item.filename || item.title || "-"),
      "- " + T("失败原因") + ": " + (hint ? hint.reason : "-"),
    ];
    if (extra && extra.length) lines.push("- " + T("补充说明") + ": " + extra.join("; "));
    lines.push("", "<!-- " + T("请在此补充：复现步骤") + " -->");
    return lines.join("\n");
  }

  function issueUrl(report) {
    return (
      "https://github.com/sevenaaaaaaaaa/zerozen/issues/new?labels=bug,download&title=" +
      encodeURIComponent(T("下载失败反馈")) +
      "&body=" +
      encodeURIComponent(report.slice(0, 1800))
    );
  }

  // ---------------- 网络：超时 + 重试 + Referer 伪装 ----------------

  class HttpError extends Error {
    constructor(status) {
      super("HTTP " + status);
      this.status = status;
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function timeoutSignal(ms, outer) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error(T("请求超时"))), ms);
    if (outer) {
      if (outer.aborted) ctl.abort(outer.reason);
      else outer.addEventListener("abort", () => ctl.abort(outer.reason), { once: true });
    }
    return { signal: ctl.signal, done: () => clearTimeout(timer) };
  }

  /**
   * 带重试的抓取。opts: { as: "text"|"buf", range: [start, end], timeout, tries, signal, ctx }
   * ctx: 任务上下文（referrer、已伪装的 host 集合），用于按需安装 Referer 规则。
   * 401/403/404/410 不重试（交给调用方刷新播放列表）；网络错误/超时/5xx/429 指数退避重试。
   */
  async function fetchRetry(url, opts) {
    const o = opts || {};
    const tries = o.tries || 4;
    const ctx = o.ctx;
    if (ctx && ctx.referrer && spoofHook) {
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch (e) {}
      if (host && !ctx.spoofed.has(host)) {
        ctx.spoofed.add(host);
        try {
          const tok = await spoofHook(url, ctx.referrer);
          if (tok) ctx.tokens.push(tok);
        } catch (e) {}
      }
    }
    let lastErr = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      if (o.signal && o.signal.aborted) throw o.signal.reason || new Error("aborted");
      const t = timeoutSignal(o.timeout || 30000, o.signal);
      try {
        const headers = {};
        if (o.range) headers.Range = "bytes=" + o.range[0] + "-" + o.range[1];
        const res = await fetch(url, { credentials: "include", redirect: "follow", signal: t.signal, headers, cache: "no-store" });
        if (!res.ok && res.status !== 206) {
          if ([401, 403, 404, 410].includes(res.status)) throw new HttpError(res.status);
          lastErr = new HttpError(res.status);
          await sleep(Math.min(8000, 800 * 2 ** attempt) + Math.random() * 300);
          continue;
        }
        if (o.as === "text") return await res.text();
        const buf = new Uint8Array(await res.arrayBuffer());
        if (o.range && res.status === 200 && buf.length > o.range[1] - o.range[0] + 1) {
          // 服务器忽略了 Range：自己切
          return buf.subarray(o.range[0], o.range[1] + 1);
        }
        return buf;
      } catch (e) {
        if (e instanceof HttpError && [401, 403, 404, 410].includes(e.status)) throw e;
        if (o.signal && o.signal.aborted) throw o.signal.reason || e;
        lastErr = e;
        await sleep(Math.min(8000, 800 * 2 ** attempt) + Math.random() * 300);
      } finally {
        t.done();
      }
    }
    throw lastErr || new Error(T("下载失败"));
  }

  // ---------------- 播放列表解析 ----------------

  function attrsOf(line) {
    const out = {};
    for (const m of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) out[m[1]] = String(m[2]).replace(/^"|"$/g, "");
    return out;
  }

  function parseMaster(text, base) {
    const lines = text.split(/\r?\n/);
    const variants = [];
    const audio = {}; // groupId -> [{ uri, name, lang, def }]
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith("#EXT-X-MEDIA:")) {
        const a = attrsOf(l.slice(13));
        if (a.TYPE === "AUDIO" && a["GROUP-ID"]) {
          (audio[a["GROUP-ID"]] = audio[a["GROUP-ID"]] || []).push({
            uri: a.URI ? new URL(a.URI, base).href : "",
            name: a.NAME || "",
            lang: a.LANGUAGE || "",
            def: a.DEFAULT === "YES",
          });
        }
        continue;
      }
      if (!l.startsWith("#EXT-X-STREAM-INF")) continue;
      const a = attrsOf(l.slice(18));
      const next = lines.slice(i + 1).find((x) => x.trim() && !x.trim().startsWith("#"));
      if (!next) continue;
      const height = parseInt((a.RESOLUTION || "").split("x")[1], 10) || 0;
      variants.push({
        url: new URL(next.trim(), base).href,
        bandwidth: parseInt(a.BANDWIDTH || "0", 10) || 0,
        resolution: a.RESOLUTION || "",
        height,
        codecs: a.CODECS || "",
        audioGroup: a.AUDIO || "",
        name: a.NAME || (height ? height + "p" : ""),
      });
    }
    for (const v of variants) {
      const group = v.audioGroup && audio[v.audioGroup];
      if (group && group.length) {
        const pick = group.find((x) => x.def && x.uri) || group.find((x) => x.uri);
        v.audioUrl = pick ? pick.uri : "";
      }
    }
    // 去重（同一地址出现在多个分组）并按画质从高到低
    const seen = new Set();
    return variants
      .filter((v) => (seen.has(v.url) ? false : (seen.add(v.url), true)))
      .sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  }

  function qualityLabel(v) {
    if (!v) return "";
    if (v.height) return v.height + "p";
    if (v.bandwidth) return Math.round(v.bandwidth / 1000) + "kbps";
    return T("未知画质");
  }

  function parseRange(spec, prevEnd) {
    const m = String(spec || "").match(/^(\d+)(?:@(\d+))?$/);
    if (!m) return null;
    const len = parseInt(m[1], 10);
    const start = m[2] !== undefined ? parseInt(m[2], 10) : prevEnd;
    return [start, start + len - 1];
  }

  function parseMedia(text, base) {
    if (!/#EXTM3U/.test(text)) throw new Error(T("不是有效的 m3u8 播放列表"));
    const lines = text.split(/\r?\n/);
    const out = { segments: [], map: null, seq: 0, endList: /#EXT-X-ENDLIST/.test(text), target: 0, duration: 0 };
    let key = null;
    let dur = 0;
    let range = null;
    let nextOffset = 0;
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      if (l.startsWith("#EXT-X-MEDIA-SEQUENCE")) out.seq = parseInt(l.split(":")[1], 10) || 0;
      else if (l.startsWith("#EXT-X-TARGETDURATION")) out.target = parseFloat(l.split(":")[1]) || 0;
      else if (l.startsWith("#EXTINF")) dur = parseFloat(l.slice(8)) || 0;
      else if (l.startsWith("#EXT-X-BYTERANGE")) {
        range = parseRange(l.split(":")[1], nextOffset);
      } else if (l.startsWith("#EXT-X-MAP")) {
        const a = attrsOf(l.slice(11));
        if (a.URI) {
          const r = a.BYTERANGE ? parseRange(a.BYTERANGE, 0) : null;
          out.map = { url: new URL(a.URI, base).href, range: r };
        }
      } else if (l.startsWith("#EXT-X-KEY")) {
        const a = attrsOf(l.slice(11));
        if (!a.METHOD || a.METHOD === "NONE") key = null;
        else key = { method: a.METHOD, uri: a.URI ? new URL(a.URI, base).href : "", iv: (a.IV || "").replace(/^0x/i, "") };
      } else if (!l.startsWith("#")) {
        const seg = { url: new URL(l, base).href, key, dur, sn: out.seq + out.segments.length };
        if (range) {
          seg.range = range;
          nextOffset = range[1] + 1;
        }
        out.segments.push(seg);
        out.duration += dur;
        dur = 0;
        range = null;
      }
    }
    return out;
  }

  function isFmp4(media) {
    return !!media.map || /\.(m4s|mp4|m4v|m4a|cmfv|cmfa)(\?|#|$)/i.test((media.segments[0] || {}).url || "");
  }

  async function probeM3u8(url, ctx) {
    const text = await fetchRetry(url, { as: "text", timeout: 20000, tries: 3, ctx });
    if (/#EXT-X-STREAM-INF/.test(text)) {
      const variants = parseMaster(text, url);
      return { master: true, url, variants: variants.map((v) => ({ ...v, label: qualityLabel(v) })) };
    }
    const media = parseMedia(text, url);
    return {
      master: false,
      url,
      live: !media.endList,
      fmp4: isFmp4(media),
      aes: media.segments.some((s) => s.key && s.key.method === "AES-128"),
      drm: media.segments.some((s) => s.key && s.key.method !== "AES-128"),
      segments: media.segments.length,
      duration: media.duration,
    };
  }

  // ---------------- 解密 ----------------

  const keyCache = new Map();

  async function getKey(uri, ctx) {
    if (keyCache.has(uri)) return keyCache.get(uri);
    const p = fetchRetry(uri, { as: "buf", timeout: 20000, ctx }).then((raw) => {
      if (raw.length !== 16) throw new Error(T("AES 密钥长度异常（$1 字节）", raw.length));
      return crypto.subtle.importKey("raw", raw, { name: "AES-CBC" }, false, ["decrypt"]);
    });
    keyCache.set(uri, p);
    p.catch(() => keyCache.delete(uri));
    return p;
  }

  function ivFor(key, sn) {
    if (key && key.iv) {
      const hex = key.iv.padStart(32, "0").slice(-32);
      return Uint8Array.from(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
    }
    const iv = new Uint8Array(16);
    let n = BigInt(sn);
    for (let i = 15; i >= 0; i--) {
      iv[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    return iv;
  }

  async function decrypt(buf, seg, ctx) {
    if (!seg.key || !seg.key.uri) return buf;
    const key = await getKey(seg.key.uri, ctx);
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivFor(seg.key, seg.sn) }, key, buf));
    } catch (e) {
      throw new Error(T("分片解密失败（AES-128）") + ": " + ((e && e.message) || e));
    }
  }

  // ---------------- TS → MP4 转封装 ----------------

  /** 依次读入 TS 分片（Blob 列表），转封装为 MP4 Blob。没有 mux.js 或转换失败返回 null。 */
  async function remuxTs(blobs, kind, onProgress) {
    const mux = globalThis.muxjs;
    if (!mux || !mux.mp4 || !mux.mp4.Transmuxer) return null;
    try {
      const t = new mux.mp4.Transmuxer({ remux: true });
      const parts = [];
      let init = null;
      let gotVideo = false;
      t.on("data", (seg) => {
        if (!init && seg.initSegment && seg.initSegment.byteLength) {
          init = seg.initSegment;
          parts.push(new Uint8Array(init));
        }
        if (seg.data && seg.data.byteLength) parts.push(new Uint8Array(seg.data));
        if (seg.type === "combined" || seg.type === "video") gotVideo = true;
      });
      for (let i = 0; i < blobs.length; i++) {
        t.push(new Uint8Array(await blobs[i].arrayBuffer()));
        t.flush();
        if (onProgress && i % 20 === 0) onProgress(i, blobs.length);
      }
      if (!init || parts.length < 2) return null;
      if (kind === "video" && !gotVideo) return null;
      return new Blob(parts, { type: kind === "audio" ? "audio/mp4" : "video/mp4" });
    } catch (e) {
      return null;
    }
  }

  // ---------------- HLS 下载 ----------------

  /**
   * 下载一条媒体播放列表的全部分片到 IndexedDB（key 前缀区分视频/音轨）。
   * 返回 { media, fmp4, keys }。支持暂停（ctl.signal）、失败重试、链接过期自动换新地址。
   */
  async function fetchTrack(taskId, playlistUrl, prefix, ctl, ctx, stat) {
    const Store = globalThis.ZZDLStore;
    let media = parseMedia(await fetchRetry(playlistUrl, { as: "text", timeout: 20000, ctx, signal: ctl.signal }), playlistUrl);
    if (!media.segments.length) throw new Error(T("没有解析到分片"));
    if (media.segments.some((s) => s.key && s.key.method !== "AES-128")) {
      throw new Error(T("该流使用 SAMPLE-AES/DRM 加密，无法离线下载"));
    }
    const fmp4 = isFmp4(media);
    const have = new Set(await Store.chunkKeys(taskId));
    const mapKey = prefix + "map";
    if (media.map && !have.has(mapKey)) {
      const buf = await fetchRetry(media.map.url, { as: "buf", range: media.map.range, ctx, signal: ctl.signal });
      await Store.saveChunk(taskId, mapKey, buf);
      stat.bytes += buf.length;
    }
    const keyOf = (i) => prefix + i;
    stat.total += media.segments.length;
    stat.done += media.segments.filter((_, i) => have.has(keyOf(i))).length;
    stat.duration = Math.max(stat.duration || 0, media.duration);
    ctl.report();

    // 分片地址常带时效签名：403/404/410 时重拉播放列表换新地址（多个 worker 共享一次刷新）
    let fresh = null;
    let freshAt = 0;
    async function refreshed(i) {
      if (!fresh || Date.now() - freshAt > 8000) {
        fresh = (async () => parseMedia(await fetchRetry(playlistUrl, { as: "text", timeout: 20000, ctx, signal: ctl.signal }), playlistUrl))();
        freshAt = Date.now();
      }
      const m = await fresh;
      return m.segments[i];
    }

    const queue = media.segments.map((s, i) => ({ ...s, i })).filter((s) => !have.has(keyOf(s.i)));
    let failed = null;
    const conc = Math.max(1, Math.min(12, ctl.concurrency || 6));
    const workers = Array.from({ length: conc }, async () => {
      while (queue.length && !failed && !ctl.signal.aborted) {
        const seg = queue.shift();
        let attempts = 0;
        for (;;) {
          try {
            let buf;
            try {
              buf = await fetchRetry(seg.url, { as: "buf", range: seg.range, ctx, signal: ctl.signal });
            } catch (e) {
              if (!(e instanceof HttpError)) throw e;
              const alt = await refreshed(seg.i).catch(() => null);
              if (!alt || alt.url === seg.url) throw e;
              seg.url = alt.url;
              seg.key = alt.key;
              buf = await fetchRetry(seg.url, { as: "buf", range: alt.range, ctx, signal: ctl.signal });
            }
            buf = await decrypt(buf, seg, ctx);
            await Store.saveChunk(taskId, keyOf(seg.i), buf);
            stat.done++;
            stat.bytes += buf.length;
            ctl.report();
            break;
          } catch (e) {
            if (ctl.signal.aborted) return;
            // 整轮重试：网络抖动时不让单个分片拖垮整个任务
            if (++attempts < 3 && !(e instanceof HttpError)) {
              await sleep(1500 * attempts);
              continue;
            }
            failed = failed || e;
            return;
          }
        }
      }
    });
    await Promise.all(workers);
    if (failed) throw failed;
    const keys = [];
    if (media.map) keys.push(mapKey);
    for (let i = 0; i < media.segments.length; i++) keys.push(keyOf(i));
    return { media, fmp4, keys };
  }

  // 直播录制：轮询播放列表追加新分片，直到用户停止 / 出现 ENDLIST / 达到时长上限
  async function recordLive(taskId, playlistUrl, ctl, ctx, stat) {
    const Store = globalThis.ZZDLStore;
    const seen = new Set((await Store.chunkKeys(taskId)).filter((k) => /^\d+$/.test(k)).map(Number));
    let media = null;
    let mapDone = (await Store.chunkKeys(taskId)).includes("map");
    const started = Date.now();
    const maxMs = (ctl.liveMaxMinutes || 240) * 60000;
    for (;;) {
      media = parseMedia(await fetchRetry(playlistUrl, { as: "text", timeout: 20000, ctx, signal: ctl.signal }), playlistUrl);
      if (media.segments.some((s) => s.key && s.key.method !== "AES-128")) throw new Error(T("该流使用 SAMPLE-AES/DRM 加密，无法离线下载"));
      if (media.map && !mapDone) {
        await Store.saveChunk(taskId, "map", await fetchRetry(media.map.url, { as: "buf", range: media.map.range, ctx, signal: ctl.signal }));
        mapDone = true;
      }
      for (const seg of media.segments) {
        if (ctl.signal.aborted) break;
        if (seen.has(seg.sn)) continue;
        try {
          const buf = await decrypt(await fetchRetry(seg.url, { as: "buf", range: seg.range, ctx, signal: ctl.signal, tries: 3 }), seg, ctx);
          await Store.saveChunk(taskId, String(seg.sn), buf);
          seen.add(seg.sn);
          stat.done++;
          stat.total = stat.done;
          stat.bytes += buf.length;
          stat.duration = (stat.duration || 0) + (seg.dur || 0);
          ctl.report();
        } catch (e) {
          if (ctl.signal.aborted) break;
          // 直播分片过期就跳过，不中断录制
        }
      }
      if (ctl.signal.aborted || media.endList || Date.now() - started > maxMs) break;
      await sleep(Math.max(1000, (media.target || 4) * 1000 * 0.7));
    }
    const keys = [];
    if (mapDone) keys.push("map");
    for (const sn of Array.from(seen).sort((a, b) => a - b)) keys.push(String(sn));
    return { media, fmp4: isFmp4(media), keys };
  }

  async function assemble(taskId, track, kind, keepTs, ctl) {
    const Store = globalThis.ZZDLStore;
    const blobs = await Store.readChunks(taskId, track.keys);
    if (blobs.length !== track.keys.length) throw new Error(T("分片缺失（$1/$2）", blobs.length, track.keys.length));
    if (track.fmp4) {
      return { blob: new Blob(blobs, { type: kind === "audio" ? "audio/mp4" : "video/mp4" }), ext: kind === "audio" ? "m4a" : "mp4" };
    }
    if (!keepTs) {
      ctl.phase(T("转换为 MP4…"));
      const mp4 = await remuxTs(blobs, kind, () => {});
      if (mp4) return { blob: mp4, ext: kind === "audio" ? "m4a" : "mp4", remuxed: true };
      ctl.note(T("TS 转 MP4 失败，已按原格式 .ts 保存（可用 VLC/IINA 播放）"));
    }
    return { blob: new Blob(blobs, { type: "video/mp2t" }), ext: "ts" };
  }

  /**
   * 执行一个 HLS 任务。task: { id, url, mediaUrl?, audioUrl?, quality?, referrer, keepTs, live }
   * ctl: { signal, concurrency, report(stat), phase(text), note(text), save(blob, ext, suffix) → Promise, update(patch) }
   * 返回 { saved: [...] }；暂停时抛出 AbortError（分片保留，可继续）。
   */
  async function runHls(task, ctl) {
    const ctx = { referrer: task.referrer || task.pageUrl || "", spoofed: new Set(), tokens: [] };
    const stat = { done: 0, total: 0, bytes: 0, duration: 0 };
    ctl.report = throttle(() => ctl.onStats({ ...stat }), 400);
    try {
      let mediaUrl = task.mediaUrl;
      let audioUrl = task.audioUrl || "";
      if (!mediaUrl) {
        ctl.phase(T("解析播放列表…"));
        const text = await fetchRetry(task.url, { as: "text", timeout: 20000, ctx, signal: ctl.signal });
        if (/#EXT-X-STREAM-INF/.test(text)) {
          const variants = parseMaster(text, task.url);
          if (!variants.length) throw new Error(T("主播放列表为空"));
          const pick = (task.variantUrl && variants.find((v) => v.url === task.variantUrl)) || variants[0];
          mediaUrl = pick.url;
          audioUrl = pick.audioUrl || "";
          ctl.update({ mediaUrl, audioUrl, quality: qualityLabel(pick) });
        } else {
          mediaUrl = task.url;
          const media = parseMedia(text, task.url);
          ctl.update({ mediaUrl, live: !media.endList });
          task.live = !media.endList;
        }
      }
      ctl.phase(task.live ? T("直播录制中（点「停止」结束并保存）") : T("下载分片…"));
      const video = task.live
        ? await recordLive(task.id, mediaUrl, ctl, ctx, stat)
        : await fetchTrack(task.id, mediaUrl, "", ctl, ctx, stat);
      let audio = null;
      if (audioUrl && !task.live && !ctl.signal.aborted) {
        ctl.phase(T("下载独立音轨…"));
        audio = await fetchTrack(task.id, audioUrl, "a", ctl, ctx, stat);
      }
      if (ctl.signal.aborted && !task.live) throw Object.assign(new Error("paused"), { name: "AbortError" });
      if (!video.keys.length) throw new Error(T("没有录到任何分片"));
      ctl.report.cancel();
      ctl.onStats({ ...stat });
      ctl.phase(T("合并文件…"));
      const saved = [];
      const v = await assemble(task.id, video, "video", task.keepTs, ctl);
      saved.push(await ctl.save(v.blob, v.ext, ""));
      if (audio) {
        const a = await assemble(task.id, audio, "audio", task.keepTs, ctl);
        saved.push(await ctl.save(a.blob, a.ext, " (" + T("音轨") + ")"));
        ctl.note(T("该视频音画分轨，已分别保存视频与音轨两个文件"));
      }
      return { saved, size: v.blob.size, bytes: stat.bytes };
    } finally {
      ctl.report && ctl.report.cancel && ctl.report.cancel();
      if (unspoofHook) for (const tok of ctx.tokens) unspoofHook(tok);
    }
  }

  globalThis.ZZDLEngine = {
    init,
    // 下载
    runHls,
    probeM3u8,
    remuxTs,
    fetchRetry,
    // 解析
    parseMaster,
    parseMedia,
    qualityLabel,
    // 工具
    sanitize,
    titleToName,
    nameFromUrl,
    extOf,
    classifyExt,
    dirForType,
    bytes,
    duration,
    throttle,
    errorHint,
    buildReport,
    issueUrl,
    HttpError,
  };
})();

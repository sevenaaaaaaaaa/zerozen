// 下载引擎（弹窗 / 工具箱共用）：m3u8 与多线程分段下载，含断点续传。
// 依赖：ZZDLStore（分片存储）、ZZUI（send/ensurePermission/T）。经 ZZDLEngine.init({ UI, T, referrer }) 注入。
(function () {
  let UI = null;
  let T = (s) => s;
  let referrerOf = () => "";

  function init(opts) {
    UI = (opts && opts.UI) || UI;
    T = (opts && opts.T) || T;
    referrerOf = (opts && opts.referrerOf) || referrerOf;
  }

  async function download(url, filename) {
    const granted = await UI.ensurePermission("downloads");
    if (!granted) throw new Error(T("需要 downloads 权限"));
    const api = globalThis.ZZ.browser;
    const opts = { url, filename: filename.replace(/^\/+/, ""), conflictAction: "uniquify" };
    return new Promise((resolve, reject) => {
      let ret;
      try {
        ret = api.downloads.download(opts, (id) => {
          const err = globalThis.ZZ.browser.runtime.lastError;
          if (err || id === undefined) reject(new Error((err && err.message) || "download failed"));
          else resolve(id);
        });
      } catch (e) {
        reject(e);
        return;
      }
      if (ret && typeof ret.catch === "function") ret.catch(reject);
    });
  }

  function sanitize(name) {
    return (
      String(name || "download")
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "download"
    );
  }

  // 按扩展名分类，用于分目录归档与任务分组
  function classifyExt(nameOrUrl) {
    const ext = (String(nameOrUrl || "").split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
    if (/^(mp4|ts|webm|mkv|avi|mov|flv|m4v|m3u8|mpd)$/.test(ext)) return "video";
    if (/^(mp3|m4a|flac|wav|aac|ogg|opus)$/.test(ext)) return "audio";
    if (/^(jpg|jpeg|png|gif|webp|avif|bmp|svg|ico)$/.test(ext)) return "image";
    if (/^(zip|rar|7z|tar|gz|bz2|xz|apk|dmg|iso)$/.test(ext)) return "archive";
    if (/^(pdf|doc|docx|xls|xlsx|ppt|pptx|epub|mobi|txt|md|csv)$/.test(ext)) return "doc";
    return "other";
  }

  // 分类 → 归档目录（dirs 可由调用方传入自定义映射）
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
    return d[cat] || fallback[cat] || "ZeroZen/下载";
  }

  // 失败原因分析：chrome.downloads 错误码 / 引擎错误消息 → { reason, advice }
  function errorHint(err) {
    const raw = String((err && (err.error || err.message)) || err || "").trim();
    const code = String((err && err.error) || "").trim();
    const map = {
      FILE_FAILED: [T("本地写入失败"), T("磁盘空间不足或文件被占用；清理空间或更换保存目录后重试")],
      FILE_ACCESS_DENIED: [T("无写入权限"), T("下载目录不可写；在系统设置中检查浏览器/扩展的文件访问权限")],
      FILE_NO_SPACE: [T("磁盘空间不足"), T("清理磁盘空间后重试")],
      FILE_NAME_TOO_LONG: [T("文件名过长"), T("换一个更短的文件名")],
      NETWORK_TIMEOUT: [T("连接超时"), T("网络不稳定或服务器响应慢；稍后重试，大文件建议用多线程分段模式")],
      NETWORK_FAILED: [T("网络错误"), T("连接被重置或 DNS 解析失败；检查网络/代理后重试")],
      NETWORK_INVALID_REQUEST: [T("请求无效"), T("链接可能已过期或需要登录；在原页面重新获取地址")],
      SERVER_BAD_CONTENT: [T("服务器返回 404"), T("文件不存在或链接已失效；回到来源页面重新获取")],
      SERVER_FORBIDDEN: [T("服务器返回 403"), T("服务器拒绝访问；可能需要登录、Referer 或已限流，稍后重试")],
      SERVER_UNAUTHORIZED: [T("服务器返回 401"), T("需要登录或鉴权；在浏览器登录该站点后重试")],
      SERVER_FAILED: [T("服务器错误（5xx）"), T("服务器临时故障；稍后重试")],
      SERVER_CONTENT_LENGTH_MISMATCH: [T("数据不完整"), T("服务器传输中断；重试或改用多线程分段模式")],
      SERVER_CROSS_ORIGIN_REDIRECT: [T("跨域重定向被拒"), T("链接重定向到其他域名被浏览器拒绝；在原页面重新获取地址")],
      USER_CANCELED: [T("已取消"), ""],
      CRASH: [T("浏览器崩溃"), T("重启浏览器后重试")],
    };
    if (code && map[code]) return { reason: map[code][0], advice: map[code][1], raw };
    // 引擎错误的中文消息里带关键词的补充建议
    if (/m3u8|分片/.test(raw)) return { reason: raw, advice: T("分片下载失败多为链接过期或防盗链；重新嗅探获取新地址，或稍后重试（进度已保留）"), raw };
    if (/Range|分段/.test(raw)) return { reason: raw, advice: T("该服务器不支持断点续传；取消勾选「多线程分段」改用默认模式"), raw };
    if (/HTTP|网络|timeout|超时/i.test(raw)) return { reason: raw, advice: T("检查网络连接后重试；目标站点可能限流或需要代理"), raw };
    if (/权限/.test(raw)) return { reason: raw, advice: T("在控制台「统计与诊断」→「可选权限」中开启所需权限"), raw };
    return { reason: raw || T("未知错误"), advice: "", raw };
  }

  // 构造可反馈的诊断报告文本（用于 GitHub issue 或剪贴板）
  function buildReport(item, extra) {
    const lines = [
      "- " + T("扩展版本") + ": ZeroZen " + ((globalThis.ZZ && ZZ.browser && ZZ.browser.runtime && ZZ.browser.runtime.getManifest) ? ZZ.browser.runtime.getManifest().version : "?"),
      "- " + T("时间") + ": " + new Date().toISOString(),
      "- " + T("下载地址") + ": " + (item.url || "-"),
      "- " + T("文件名") + ": " + (item.filename || item.name || "-"),
      "- " + T("失败原因") + ": " + (item.hint ? item.hint.reason + (item.hint.raw && item.hint.raw !== item.hint.reason ? " (" + item.hint.raw + ")" : "") : "-"),
    ];
    if (item.totalBytes) lines.push("- " + T("大小") + ": " + bytes(item.totalBytes));
    if (extra && extra.length) lines.push("- " + T("补充说明") + ": " + extra.join("; "));
    lines.push("", "<!-- " + T("请在此补充：站点地址、复现步骤") + " -->");
    return lines.join("\n");
  }

  function issueUrl(report) {
    return (
      "https://github.com/sevenaaaaaaaaa/zerozen/issues/new" +
      "?labels=bug,download" +
      "&title=" + encodeURIComponent(T("下载失败反馈")) +
      "&body=" + encodeURIComponent(report.slice(0, 1800))
    );
  }

  function bytes(n) {
    if (n === undefined || n === null || Number.isNaN(n)) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = Number(n);
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return v.toFixed(i ? 1 : 0) + " " + units[i];
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
    // 收尾（完成/删除任务）前必须 cancel，避免挂起的写入把已清理的任务复活
    wrapped.cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return wrapped;
  }

  async function fetchViaBg(url, as) {
    const res = await UI.send({
      type: "zz:toolbox:fetch",
      payload: { url, as: as || "text", referrer: referrerOf() || "" },
    });
    if (!res || !res.ok) throw new Error((res && res.error) || T("后台抓取失败"));
    return res;
  }

  function decodeBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function fetchText(url) {
    try {
      const proxied = await fetchViaBg(url, "text");
      return proxied.text || "";
    } catch (e) {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error((e && e.message) || "HTTP " + res.status);
      return await res.text();
    }
  }

  async function fetchBuf(url) {
    try {
      const proxied = await fetchViaBg(url, "bin");
      if (proxied.base64) return decodeBase64(proxied.base64);
    } catch (e) {}
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  function parseMaster(text, base) {
    const lines = text.split(/\r?\n/);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l.startsWith("#EXT-X-STREAM-INF")) continue;
      const attrs = {};
      for (const m of l.matchAll(/([A-Z-]+)=("[^"]*"|[^,]*)/g)) attrs[m[1]] = String(m[2]).replace(/"/g, "");
      const next = lines.slice(i + 1).find((x) => x.trim() && !x.trim().startsWith("#"));
      if (next) {
        const height = parseInt((attrs.RESOLUTION || "").split("x")[1], 10) || 0;
        variants.push({
          url: new URL(next.trim(), base).href,
          bandwidth: parseInt(attrs.BANDWIDTH || "0", 10) || 0,
          resolution: attrs.RESOLUTION || "",
          height,
          name: attrs.NAME || (height ? height + "p" : ""),
        });
      }
    }
    // 画质从高到低：分辨率优先，其次带宽（部分站点不标 RESOLUTION）
    return variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  }

  function qualityLabel(v) {
    if (!v) return "";
    if (v.height) return v.height + "p";
    if (v.bandwidth) return Math.round(v.bandwidth / 1000) + "kbps";
    return T("未知画质");
  }

  function parseMedia(text, base) {
    const lines = text.split(/\r?\n/);
    const out = { segments: [], map: "", seq: 0, endList: /#EXT-X-ENDLIST/.test(text) };
    let key = null;
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      if (l.startsWith("#EXT-X-MEDIA-SEQUENCE")) out.seq = parseInt(l.split(":")[1], 10) || 0;
      else if (l.startsWith("#EXT-X-MAP")) {
        const m = l.match(/URI="([^"]+)"/);
        if (m) out.map = new URL(m[1], base).href;
      } else if (l.startsWith("#EXT-X-KEY")) {
        if (/METHOD=NONE/.test(l)) key = null;
        else {
          const uri = (l.match(/URI="([^"]+)"/) || [])[1];
          const iv = (l.match(/IV=0x([0-9A-Fa-f]+)/) || [])[1];
          key = { uri: uri ? new URL(uri, base).href : "", iv };
        }
      } else if (!l.startsWith("#")) {
        out.segments.push({ url: new URL(l, base).href, key });
      }
    }
    return out;
  }

  const keyCache = new Map();

  async function getKey(uri) {
    if (keyCache.has(uri)) return keyCache.get(uri);
    const buf = await fetchBuf(uri);
    keyCache.set(uri, buf);
    return buf;
  }

  function ivFor(key, index, seq) {
    if (key && key.iv) {
      const hex = key.iv.replace(/^0x/i, "").padStart(32, "0").slice(-32);
      return Uint8Array.from(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
    }
    const iv = new Uint8Array(16);
    let n = BigInt(seq + index);
    for (let i = 15; i >= 0; i--) {
      iv[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    return iv;
  }

  async function saveBlob(blob, path) {
    const blobUrl = URL.createObjectURL(blob);
    try {
      await download(blobUrl, path);
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    }
  }

  async function downloadM3u8(url, opts) {
    const {
      concurrency = 4,
      onProgress = () => {},
      isCancelled = () => false,
      nameBase = "video",
      dir = "ZeroZen/视频",
      tsAsMp4 = false,
    } = opts || {};
    const Store = globalThis.ZZDLStore;
    const tid = Store ? Store.taskId("m3u8", url) : null;
    // 续传：按 url 找到旧任务；直播流（无 ENDLIST）内容会变，不做续传
    let task = tid ? await Store.getTask(tid) : null;
    if (task && task.status === "done") task = null;

    let mediaUrl = task ? task.mediaUrl : url;
    let text = await fetchText(mediaUrl);
    if (!task && /#EXT-X-STREAM-INF/.test(text)) {
      const variants = parseMaster(text, url);
      if (!variants.length) throw new Error(T("主播放列表为空"));
      const top = variants[0];
      const topQ = top.height || top.bandwidth || 0;
      // 在最高画质附近（≥80%）优先选 fMP4 变体（可自动合成 mp4），绝不降档换格式
      let pick = top;
      for (const v of variants.slice(0, 3)) {
        try {
          const probe = parseMedia(await fetchText(v.url), v.url);
          const fmp4 = !!probe.map || /\.(m4s|mp4)(\?|#|$)/i.test((probe.segments[0] || {}).url || "");
          const vq = v.height || v.bandwidth || 0;
          if (fmp4 && (!topQ || !vq || vq >= topQ * 0.8)) {
            pick = v;
            break;
          }
        } catch (e) {}
      }
      if (variants.length > 1) {
        onProgress(T("可用画质：$1", variants.slice(0, 4).map(qualityLabel).join(" / ")));
      }
      onProgress(T("已选最高画质：$1", qualityLabel(pick)));
      mediaUrl = pick.url;
      text = await fetchText(mediaUrl);
    }
    const media = parseMedia(text, mediaUrl);
    if (!media.segments.length) throw new Error(T("没有解析到分片"));
    const isFmp4 = !!media.map || /\.(m4s|mp4)(\?|#|$)/i.test(media.segments[0].url);
    const resumable = media.endList && !!Store;
    if (resumable && task && (task.total !== media.segments.length || task.mapUrl !== (media.map || "") || !!media.map !== !!task.hasMap)) {
      onProgress(T("播放列表已变化，重新下载"));
      await Store.removeTask(tid);
      task = null;
    }
    if (!resumable) task = null;

    const total = media.segments.length;
    const have = new Set(resumable ? await Store.chunkKeys(tid) : []);
    if (resumable && !task && have.size) {
      // 有分片但没有任务元数据（上次运行在写元数据前中断），无法校验一致性，清掉重下
      await Store.removeTask(tid);
      have.clear();
    }
    const hasMapChunk = have.has("map");
    const segHave = new Set(Array.from(have).filter((k) => k !== "map"));
    let done = total - media.segments.map((_, i) => i).filter((i) => !segHave.has(String(i))).length;
    if (resumable && done > 0) onProgress(T("发现未完成任务（$1），继续下载", T("分片 $1/$2", done, total)));
    const meta = {
      id: tid,
      kind: "m3u8",
      url,
      nameBase,
      dir,
      tsAsMp4: !!tsAsMp4,
      concurrency,
      mediaUrl,
      total,
      mapUrl: media.map || "",
      hasMap: !!media.map,
      seq: media.seq,
      done,
      status: "running",
      createdAt: task ? task.createdAt : Date.now(),
    };
    if (resumable) await Store.putTask(meta);
    const saveMeta = resumable ? throttle((d) => Store.putTask({ ...meta, done: d, status: "paused" }), 2000) : null;

    if (media.map && !hasMapChunk) {
      onProgress(T("下载初始化分片…"));
      const mapBuf = await fetchBuf(media.map);
      if (resumable) await Store.saveChunk(tid, "map", mapBuf);
    }

    let failed = null;
    // 分片地址常带时效签名，长时间下载后会失效：失败时重拉播放列表换取新地址（5 秒内共享一次刷新）
    let freshCache = null;
    let freshAt = 0;
    async function fetchSegmentResilient(seg) {
      try {
        return await fetchBuf(seg.url);
      } catch (e) {
        const now = Date.now();
        if (!freshCache || now - freshAt > 5000) {
          try {
            freshCache = parseMedia(await fetchText(mediaUrl), mediaUrl);
            freshAt = now;
          } catch (e2) {
            throw e;
          }
        }
        const freshSeg = freshCache && freshCache.segments[seg.i];
        if (freshSeg && freshSeg.url && freshSeg.url !== seg.url) return await fetchBuf(freshSeg.url);
        throw e;
      }
    }
    const memParts = resumable ? null : new Array(total + (media.map ? 1 : 0));
    const queue = media.segments.map((s, i) => ({ ...s, i })).filter((s) => !segHave.has(String(s.i)));
    const workers = Array.from({ length: Math.max(1, Math.min(12, concurrency)) }, async () => {
      while (queue.length) {
        if (isCancelled() || failed) return;
        const seg = queue.shift();
        try {
          let buf = await fetchSegmentResilient(seg);
          if (seg.key && seg.key.uri) {
            let rawKey;
            try {
              rawKey = await getKey(seg.key.uri);
            } catch (e) {
              rawKey = await fetchBuf(seg.key.uri);
            }
            const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CBC" }, false, ["decrypt"]);
            buf = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivFor(seg.key, seg.i, media.seq) }, cryptoKey, buf));
          }
          if (resumable) await Store.saveChunk(tid, String(seg.i), buf);
          else memParts[seg.i + (media.map ? 1 : 0)] = buf;
          done++;
          if (done % 5 === 0 || done === total) onProgress(T("分片 $1/$2", done, total));
          if (saveMeta) saveMeta(done);
        } catch (e) {
          failed = failed || e;
        }
      }
    });
    await Promise.all(workers);

    if (failed) {
      if (resumable) {
        saveMeta.cancel();
        await Store.putTask({ ...meta, done, status: "error", error: String((failed && failed.message) || failed) });
      }
      throw failed;
    }
    if (isCancelled()) {
      if (resumable) {
        saveMeta.cancel();
        await Store.putTask({ ...meta, done, status: "paused" });
      }
      return { cancelled: true, taskId: resumable ? tid : null };
    }

    const ext = isFmp4 || tsAsMp4 ? "mp4" : "ts";
    const name = nameBase + "." + ext;
    const mime = isFmp4 || tsAsMp4 ? "video/mp4" : "video/mp2t";
    let blob;
    if (resumable) {
      const order = [];
      if (media.map) order.push("map");
      for (let i = 0; i < total; i++) order.push(String(i));
      const blobs = await Store.readChunks(tid, order);
      if (blobs.length !== order.length) {
        // 缺分片绝不静默合并出坏视频：保留任务进度，报错后可继续
        await Store.putTask({ ...meta, done, status: "paused", error: "" });
        throw new Error(T("分片缺失（$1/$2）", blobs.length, order.length));
      }
      blob = new Blob(blobs, { type: mime });
    } else {
      blob = new Blob(memParts.filter(Boolean), { type: mime });
    }
    await saveBlob(blob, dir + "/" + name);
    if (resumable) {
      saveMeta.cancel();
      await Store.removeTask(tid);
      onProgress(T("本地缓存分片已清理"));
    }
    return { cancelled: false, taskId: resumable ? tid : null, saved: dir + "/" + name, size: blob.size, isFmp4 };
  }

  const DL_SUB_CHUNK = 8 * 1024 * 1024; // 断点续传粒度：8MB 子分片

  async function multiThreadDownload(url, name, dir, threads, onProgress, isCancelled) {
    const Store = globalThis.ZZDLStore;
    const head = await fetch(url, { method: "HEAD", credentials: "include" });
    const len = Number(head.headers.get("content-length") || 0);
    const accept = head.headers.get("accept-ranges") || "";
    if (!len) throw new Error(T("服务器未返回文件大小"));
    if (!/bytes/i.test(accept) && !(head.status === 206)) throw new Error(T("服务器不支持分段下载"));
    if (len > 2 * 1024 * 1024 * 1024) throw new Error(T("文件超过 2GB，请使用默认模式"));
    const total = len;
    const tid = Store ? Store.taskId("multi", url, name, total) : null;
    // 续传：同 url+文件名+大小 的历史任务直接复用；服务器内容变了（ETag/Last-Modified 对不上）就清掉重下
    let task = tid ? await Store.getTask(tid) : null;
    if (task && (task.status === "done" || task.total !== total)) {
      await Store.removeTask(tid);
      task = null;
    }
    const etag = head.headers.get("etag") || "";
    const lastModified = head.headers.get("last-modified") || "";
    if (task && (task.etag || task.lastModified) && (task.etag !== etag || task.lastModified !== lastModified)) {
      await Store.removeTask(tid);
      task = null;
    }
    const n = Math.ceil(total / DL_SUB_CHUNK);
    const stored = task && tid ? await Store.chunkSizes(tid) : { sizes: {}, total: 0 };
    const have = new Set(Object.keys(stored.sizes));
    let received = stored.total;
    if (task && received > 0) onProgress(received, total);
    const meta = {
      id: tid,
      kind: "multi",
      url,
      name,
      dir,
      threads,
      total,
      etag,
      lastModified,
      done: received,
      status: "running",
      createdAt: task ? task.createdAt : Date.now(),
    };
    if (tid) await Store.putTask(meta);
    const saveMeta = tid ? throttle((d) => Store.putTask({ ...meta, done: d, status: "paused" }), 2000) : null;

    let cancelled = false;
    let failed = null;
    const queue = [];
    for (let i = 0; i < n; i++) if (!have.has(String(i))) queue.push(i);
    const workers = Array.from({ length: Math.max(2, Math.min(8, threads)) }, async () => {
      while (queue.length) {
        if (cancelled || failed) return;
        const i = queue.shift();
        const start = i * DL_SUB_CHUNK;
        const end = Math.min(total - 1, start + DL_SUB_CHUNK - 1);
        try {
          if (isCancelled && isCancelled()) {
            cancelled = true;
            return;
          }
          const res = await fetch(url, { headers: { Range: "bytes=" + start + "-" + end }, credentials: "include" });
          if (!res.ok && res.status !== 206) throw new Error(T("分片 HTTP $1", res.status));
          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.length !== end - start + 1) throw new Error(T("分片长度不符：$1", buf.length));
          if (tid) {
            await Store.saveChunk(tid, String(i), buf);
            received += buf.length;
            saveMeta(received);
          }
          onProgress(received, total);
        } catch (e) {
          failed = failed || e;
        }
      }
    });
    await Promise.all(workers);

    if (failed) {
      if (tid) {
        saveMeta.cancel();
        await Store.putTask({ ...meta, done: received, status: "error", error: String((failed && failed.message) || failed) });
      }
      throw failed;
    }
    if (cancelled || (isCancelled && isCancelled())) {
      if (tid) {
        saveMeta.cancel();
        await Store.putTask({ ...meta, done: received, status: "paused" });
      }
      return { size: total, received, cancelled: true, taskId: tid };
    }
    const ext = (name.split(".").pop() || "").toLowerCase();
    const MIME = {
      mp4: "video/mp4",
      m4v: "video/mp4",
      ts: "video/mp2t",
      webm: "video/webm",
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
      zip: "application/zip",
      rar: "application/vnd.rar",
      "7z": "application/x-7z-compressed",
      apk: "application/vnd.android.package-archive",
      pdf: "application/pdf",
      iso: "application/x-iso9660-image",
    };
    const order = [];
    for (let i = 0; i < n; i++) order.push(String(i));
    const blobs = tid ? await Store.readChunks(tid, order) : [];
    if (tid && blobs.length !== n) {
      saveMeta.cancel();
      await Store.putTask({ ...meta, done: received, status: "paused", error: "" });
      throw new Error(T("分片缺失（$1/$2）", blobs.length, n));
    }
    const blob = new Blob(blobs, { type: MIME[ext] || "application/octet-stream" });
    await saveBlob(blob, dir + "/" + name);
    if (tid) {
      saveMeta.cancel();
      await Store.removeTask(tid);
    }
    return { size: total, received, cancelled: false, taskId: tid, saved: dir + "/" + name };
  }

  globalThis.ZZDLEngine = {
    init,
    download,
    downloadM3u8,
    multiThreadDownload,
    saveBlob,
    sanitize,
    bytes,
    throttle,
    parseMaster,
    parseMedia,
    qualityLabel,
    fetchText,
    fetchBuf,
    classifyExt,
    dirForType,
    errorHint,
    buildReport,
    issueUrl,
  };
})();

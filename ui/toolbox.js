(function () {
  const UI = globalThis.ZZUI;
  const $raw = UI.$;
  const $ = (sel) => (typeof sel === "string" && sel[0] !== "#" && sel[0] !== "." && sel[0] !== "[" ? $raw("#" + sel) : $raw(sel));
  const $$ = UI.$$;
  const api = globalThis.ZZ.browser;

  const state = {
    tabId: null,
    title: "",
    url: "",
    streams: [],
    selected: new Set(),
    images: [],
    imageSelected: new Set(),
    formats: new Set(),
    netdisk: [],
    settings: null,
    cancel: false,
  };

  function log(box, text) {
    const el = $(box);
    if (!el) return;
    el.textContent = (el.textContent ? el.textContent + "\n" : "") + text;
    el.scrollTop = el.scrollHeight;
  }

  function setLog(box, text) {
    const el = $(box);
    if (el) el.textContent = text;
  }

  function ctxTabId() {
    const m = /[?&]tab=(\d+)/.exec(location.search);
    return m ? Number(m[1]) : null;
  }

  function stripSiteName(title, href) {
    let host = "";
    try {
      host = new URL(href).hostname.replace(/^www\./, "");
    } catch (e) {}
    const brand = host.split(".")[0] || "";
    return UI.stripSiteName ? UI.stripSiteName(title, href) : fallbackTitle(title, brand);
  }

  function fallbackTitle(title, brand) {
    const t = String(title || "").trim();
    const parts = t.split(/\s*[-–—_|｜]\s*/);
    if (parts.length > 1) {
      const last = parts[parts.length - 1].trim();
      if (last.length <= 16 && (last.toLowerCase().includes(brand) || /^(youtube|bilibili|哔哩哔哩|腾讯视频|爱奇艺|优酷|芒果|抖音|快手|微博|知乎|csdn|github|x|twitter|facebook|reddit|twitch|vimeo|netflix)$/i.test(last))) {
        return parts.slice(0, -1).join(" - ").trim();
      }
    }
    return t;
  }

  function sanitize(name) {
    return String(name || "download")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "download";
  }

  function download(url, filename) {
    const opts = { url, filename, saveAs: false, conflictAction: "uniquify" };
    return new Promise((resolve, reject) => {
      try {
        const ret = api.downloads.download(opts, (id) => {
          const err = api.runtime.lastError;
          if (err || id === undefined) reject(new Error((err && err.message) || "download failed"));
          else resolve(id);
        });
        if (ret && typeof ret.then === "function") ret.then((id) => resolve(id)).catch((e) => reject(e));
      } catch (e) {
        reject(e);
      }
    });
  }

  async function proxy(type, payload) {
    return UI.send({ type: "zz:toolbox:proxy", payload: { tabId: state.tabId, type, payload } });
  }

  // ---------- context ----------
  async function loadContext() {
    const settings = await UI.send({ type: "zz:settings:get" });
    if (settings && settings.ok) {
      state.settings = settings.settings;
      $("#videoDir").value = (state.settings.toolbox && state.settings.toolbox.videoDir) || "ZeroZen/视频";
      $("#imageDir").value = (state.settings.toolbox && state.settings.toolbox.imageDir) || "ZeroZen/图片";
      $("#tsAsMp4").checked = !!(state.settings.toolbox && state.settings.toolbox.tsAsMp4);
    }
    const res = await UI.send({ type: "zz:toolbox:context", payload: { tabId: ctxTabId() } });
    if (res && res.ok) {
      state.tabId = res.tabId;
      state.title = stripSiteName(res.title, res.url);
      state.url = res.url;
      $("#ctxLabel").textContent = (res.title || res.url || "").slice(0, 48);
      $("#videoTitle").value = state.title;
    } else {
      $("#ctxLabel").textContent = "找不到网页，请在网页上打开工具箱";
    }
    const payUrl = (state.settings && state.settings.honest && state.settings.honest.url) || "";
    $("#payLine").innerHTML =
      "视频嗅探下载、图片发现、网盘资源收集均采用 <b>诚实付费</b>：免费使用，觉得好用请支持作者。" +
      (payUrl
        ? ' <a href="' + payUrl + '" target="_blank" rel="noreferrer">前往付费/打赏</a>'
        : ' <span style="color:#d97706">（付费链接可在控制台「统计与诊断」里配置）</span>');
  }

  // ---------- tabs ----------
  $$(".zz-tool-tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      $$(".zz-tool-tab").forEach((b) => b.classList.toggle("active", b === btn));
      $$(".zz-tool-panel").forEach((p) => p.classList.toggle("active", p.id === "view-" + btn.getAttribute("data-view")));
    })
  );

  // ---------- video ----------
  function renderStreams() {
    const box = $("#streamList");
    if (!state.streams.length) {
      box.innerHTML =
        '<div class="zz-card" style="padding:12px">' +
        "<b>还没有发现视频流</b>" +
        '<ol class="zz-small" style="margin:8px 0 0 18px;color:inherit">' +
        "<li>回到刚才的网页，先点一下播放（播几秒即可）</li>" +
        "<li>再回到这里点「刷新嗅探」</li>" +
        "<li>勾选流后点「下载选中」，文件会进浏览器下载目录的 ZeroZen/视频</li>" +
        "</ol>" +
        '<div class="zz-tool-row" style="margin-top:10px"><input type="text" id="manualUrl" placeholder="或手动粘贴 m3u8 地址" style="flex:1;min-width:280px" /><button class="zz-btn zz-btn-sm" id="btnAddUrl">添加</button></div>' +
        "</div>";
      const addEmpty = box.querySelector("#btnAddUrl");
      if (addEmpty) {
        addEmpty.addEventListener("click", async () => {
          const url = (box.querySelector("#manualUrl").value || "").trim();
          if (!url) return;
          await UI.send({ type: "zz:sniff:add", payload: { tabId: state.tabId, url } });
          await refreshStreams();
          state.selected.add(url);
        });
      }
      return;
    }
    box.innerHTML = state.streams
      .map((s, i) => {
        const checked = state.selected.has(s.url) ? " checked" : "";
        return (
          '<label class="zz-tool-item"><input type="checkbox" data-stream="' + i + '"' + checked + " />" +
          '<span class="zz-tag">' + s.kind.toUpperCase() + "</span>" +
          '<span class="url">' + (s.url.length > 140 ? s.url.slice(0, 140) + "…" : s.url) + "</span>" +
          (s.note ? '<span class="zz-small zz-muted">' + s.note + "</span>" : "") +
          "</label>"
        );
      })
      .join("") +
      '<div class="zz-tool-row"><input type="text" id="manualUrl" placeholder="手动粘贴 m3u8 地址" style="flex:1;min-width:280px" /><button class="zz-btn zz-btn-sm" id="btnAddUrl">添加</button></div>';
    box.querySelectorAll("input[data-stream]").forEach((cb) =>
      cb.addEventListener("change", () => {
        const s = state.streams[Number(cb.getAttribute("data-stream"))];
        if (!s) return;
        if (cb.checked) state.selected.add(s.url);
        else state.selected.delete(s.url);
      })
    );
    const add = box.querySelector("#btnAddUrl");
    if (add) {
      add.addEventListener("click", async () => {
        const url = box.querySelector("#manualUrl").value.trim();
        if (!url) return;
        await UI.send({ type: "zz:sniff:add", payload: { tabId: state.tabId, url } });
        await refreshStreams();
        state.selected.add(url);
      });
    }
  }

  async function refreshStreams() {
    const [sniff, dom] = await Promise.all([
      UI.send({ type: "zz:sniff:list", payload: { tabId: state.tabId } }),
      proxy("zz:toolbox:streams"),
    ]);
    const map = new Map();
    for (const s of (sniff && sniff.streams) || []) map.set(s.url, { url: s.url, kind: s.kind, note: "网络请求", hits: s.hits || 1 });
    for (const s of (dom && dom.streams) || []) if (!map.has(s.url)) map.set(s.url, s);
    const score = (s) => {
      let n = s.hits || 0;
      if (/master|index|manifest|playlist|main/i.test(s.url)) n += 5;
      if (s.kind === "m3u8") n += 3;
      if (/\.mp4|\.m4s/i.test(s.url)) n += 1;
      return n;
    };
    state.streams = Array.from(map.values()).sort((a, b) => score(b) - score(a));
    if (!state.selected.size && state.streams.length) state.selected.add(state.streams[0].url);
    renderStreams();
    log("videoLog", "共 " + state.streams.length + " 个流");
  }

  $("#btnStreams").addEventListener("click", refreshStreams);

  async function fetchViaBg(url, as) {
    const res = await UI.send({
      type: "zz:toolbox:fetch",
      payload: { url, as: as || "text", referrer: state.url || "" },
    });
    if (!res || !res.ok) throw new Error((res && res.error) || "后台抓取失败");
    return res;
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

  function decodeBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
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
      if (next) variants.push({ url: new URL(next.trim(), base).href, bandwidth: parseInt(attrs.BANDWIDTH || "0", 10) || 0, resolution: attrs.RESOLUTION || "" });
    }
    return variants.sort((a, b) => b.bandwidth - a.bandwidth);
  }

  function parseMedia(text, base) {
    const lines = text.split(/\r?\n/);
    const out = { segments: [], map: "", seq: 0 };
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

  async function downloadM3u8(url, opts) {
    const { concurrency = 4, onProgress = () => {}, isCancelled = () => false } = opts || {};
    let text = await fetchText(url);
    let mediaUrl = url;
    if (/#EXT-X-STREAM-INF/.test(text)) {
      const variants = parseMaster(text, url);
      if (!variants.length) throw new Error("主播放列表为空");
      let pick = variants[0];
      for (const v of variants.slice(0, 3)) {
        try {
          const probe = parseMedia(await fetchText(v.url), v.url);
          const fmp4 = !!probe.map || /\.(m4s|mp4)(\?|#|$)/i.test((probe.segments[0] || {}).url || "");
          if (fmp4) {
            pick = v;
            break;
          }
        } catch (e) {}
      }
      onProgress("选择清晰度：" + (pick.resolution || pick.bandwidth + "bps"));
      mediaUrl = pick.url;
      text = await fetchText(mediaUrl);
    }
    const media = parseMedia(text, mediaUrl);
    if (!media.segments.length) throw new Error("没有解析到分片");
    const parts = [];
    if (media.map) {
      onProgress("下载初始化分片…");
      parts.push(await fetchBuf(media.map));
    }
    let done = 0;
    const total = media.segments.length;
    const queue = media.segments.map((s, i) => ({ ...s, i }));
    const workers = Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, async () => {
      while (queue.length) {
        if (isCancelled()) throw new Error("已取消");
        const seg = queue.shift();
        let buf = await fetchBuf(seg.url);
        if (seg.key && seg.key.uri) {
          const rawKey = await getKey(seg.key.uri);
          const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CBC" }, false, ["decrypt"]);
          buf = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivFor(seg.key, seg.i, media.seq) }, cryptoKey, buf));
        }
        parts[seg.i + (media.map ? 1 : 0)] = buf;
        done++;
        if (done % 5 === 0 || done === total) onProgress("分片 " + done + "/" + total);
      }
    });
    await Promise.all(workers);
    let size = 0;
    for (const p of parts) size += p ? p.length : 0;
    const out = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      if (!p) continue;
      out.set(p, offset);
      offset += p.length;
    }
    return { data: out, isFmp4: !!media.map || /\.(m4s|mp4)(\?|#|$)/i.test(media.segments[0].url) };
  }

  $("#btnM3u8").addEventListener("click", async () => {
    const urls = Array.from(state.selected);
    if (!urls.length) {
      setLog("videoLog", "请先勾选一个流");
      return;
    }
    const title = sanitize($("#videoTitle").value || state.title || "video");
    const dir = ($("#videoDir").value || "ZeroZen/视频").replace(/\/+$/, "");
    const tsAsMp4 = $("#tsAsMp4").checked;
    state.cancel = false;
    $("#btnM3u8").disabled = true;
    setLog("videoLog", "开始下载：" + urls.length + " 个流");
    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const res = await downloadM3u8(url, {
          concurrency: (state.settings && state.settings.toolbox && state.settings.toolbox.concurrency) || 4,
          onProgress: (t) => log("videoLog", t),
          isCancelled: () => state.cancel,
        });
        const ext = res.isFmp4 || tsAsMp4 ? "mp4" : "ts";
        const name = urls.length > 1 ? title + " (" + (i + 1) + ")." + ext : title + "." + ext;
        const blob = new Blob([res.data], { type: res.isFmp4 ? "video/mp4" : "video/mp2t" });
        const blobUrl = URL.createObjectURL(blob);
        await download(blobUrl, dir + "/" + name);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        log("videoLog", "已保存 " + dir + "/" + name + "（" + Math.round(blob.size / 1048576 * 10) / 10 + " MB）");
      }
    } catch (e) {
      log("videoLog", "× 失败：" + ((e && e.message) || e));
    } finally {
      $("#btnM3u8").disabled = false;
    }
  });

  // ---------- images ----------
  function renderImages() {
    const grid = $("#imageGrid");
    const formats = new Set(state.images.map((i) => i.format));
    $("#imgFormats").innerHTML = Array.from(formats)
      .sort()
      .map((f) => '<label><input type="checkbox" data-fmt="' + f + '"' + (state.formats.has(f) ? " checked" : "") + " /> " + f + "</label>")
      .join("");
    $("#imgFormats")
      .querySelectorAll("input[data-fmt]")
      .forEach((cb) =>
        cb.addEventListener("change", () => {
          const f = cb.getAttribute("data-fmt");
          if (cb.checked) state.formats.add(f);
          else state.formats.delete(f);
          renderImageGrid();
        })
      );
    if (!state.formats.size) formats.forEach((f) => state.formats.add(f));
    renderImageGrid();
    $("#imgInfo").textContent = "共发现 " + state.images.length + " 张，已选 " + state.imageSelected.size + " 张";
  }

  function visibleImages() {
    const min = Number($("#imgMin").value) || 0;
    return state.images.filter((i) => {
      if (state.formats.size && !state.formats.has(i.format)) return false;
      if (min && i.w && i.h && i.w < min && i.h < min) return false;
      return true;
    });
  }

  function renderImageGrid() {
    const grid = $("#imageGrid");
    const imgs = visibleImages();
    grid.innerHTML = imgs
      .slice(0, 300)
      .map((img, i) => {
        const idx = state.images.indexOf(img);
        const checked = state.imageSelected.has(idx) ? " checked" : "";
        return (
          '<label class="zz-media-card"><input type="checkbox" data-img="' + idx + '"' + checked + ' style="margin:6px" />' +
          '<img loading="lazy" src="' + img.url.replace(/"/g, "&quot;") + '" alt="" />' +
          '<div class="zz-media-meta">' + img.format + (img.w ? " · " + img.w + "×" + img.h : "") + "<br />" + img.url.slice(0, 80) + "</div></label>"
        );
      })
      .join("");
    grid.querySelectorAll("input[data-img]").forEach((cb) =>
      cb.addEventListener("change", () => {
        const idx = Number(cb.getAttribute("data-img"));
        if (cb.checked) state.imageSelected.add(idx);
        else state.imageSelected.delete(idx);
        $("#imgInfo").textContent = "共发现 " + state.images.length + " 张，已选 " + state.imageSelected.size + " 张";
      })
    );
    $("#imgInfo").textContent = "共发现 " + state.images.length + " 张，已选 " + state.imageSelected.size + " 张";
  }

  $("#btnImages").addEventListener("click", async () => {
    const res = await proxy("zz:toolbox:images");
    if (!res || !res.ok) {
      setLog("imageLog", "扫描失败：" + ((res && res.error) || "无法连接页面"));
      return;
    }
    state.images = res.images || [];
    state.imageSelected.clear();
    state.formats.clear();
    if (res.title && !$("#videoTitle").value) $("#videoTitle").value = res.title;
    renderImages();
    setLog("imageLog", "扫描到 " + state.images.length + " 张图片");
  });

  $("#btnImgAll").addEventListener("click", () => {
    visibleImages().forEach((img) => state.imageSelected.add(state.images.indexOf(img)));
    renderImageGrid();
  });
  $("#btnImgNone").addEventListener("click", () => {
    state.imageSelected.clear();
    renderImageGrid();
  });
  $("#imgMin").addEventListener("change", renderImageGrid);

  $("#btnImgDownload").addEventListener("click", async () => {
    const dir = ($("#imageDir").value || "ZeroZen/图片").replace(/\/+$/, "");
    const list = Array.from(state.imageSelected).map((i) => state.images[i]).filter(Boolean);
    if (!list.length) {
      setLog("imageLog", "请先勾选图片");
      return;
    }
    setLog("imageLog", "开始下载 " + list.length + " 张…");
    let ok = 0;
    for (const img of list) {
      const base = (img.url.split(/[?#]/)[0].split("/").pop() || "image").slice(0, 60);
      const name = sanitize(base.includes(".") ? base : base + "." + (img.format === "other" ? "jpg" : img.format));
      try {
        await download(img.url, dir + "/" + name);
        ok++;
        if (ok % 10 === 0) log("imageLog", "已下载 " + ok + "/" + list.length);
      } catch (e) {
        log("imageLog", "× " + name + "：" + ((e && e.message) || e));
      }
    }
    log("imageLog", "完成：成功 " + ok + " / " + list.length);
  });

  // ---------- netdisk ----------
  function renderNetdisk() {
    const box = $("#netdiskList");
    if (!state.netdisk.length) {
      box.innerHTML = '<div class="zz-small zz-muted">没有发现网盘链接。</div>';
      return;
    }
    box.innerHTML = state.netdisk
      .map(
        (l, i) =>
          '<div class="zz-tool-item"><span class="zz-tag">' + l.providerName + "</span>" +
          '<span class="url">' + l.url.slice(0, 110) + "</span>" +
          (l.code ? '<span class="code">提取码 ' + l.code + "</span>" : "") +
          '<button class="zz-btn zz-btn-sm" data-copy="' + i + '">复制</button>' +
          '<button class="zz-btn zz-btn-sm" data-open="' + i + '">打开</button></div>'
      )
      .join("");
    box.querySelectorAll("button[data-copy]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const l = state.netdisk[Number(btn.getAttribute("data-copy"))];
        const text = l.url + (l.code ? " 提取码：" + l.code : "");
        await navigator.clipboard.writeText(text).catch(() => {});
        btn.textContent = "已复制";
        setTimeout(() => (btn.textContent = "复制"), 1500);
      })
    );
    box.querySelectorAll("button[data-open]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const l = state.netdisk[Number(btn.getAttribute("data-open"))];
        api.tabs.create({ url: l.url });
      })
    );
  }

  $("#btnNetdisk").addEventListener("click", async () => {
    const res = await proxy("zz:toolbox:netdisk");
    if (!res || !res.ok) {
      setLog("netdiskLog", "扫描失败：" + ((res && res.error) || "无法连接页面"));
      return;
    }
    state.netdisk = res.links || [];
    renderNetdisk();
    setLog("netdiskLog", "发现 " + state.netdisk.length + " 条资源" + (state.netdisk.length ? "，含提取码 " + state.netdisk.filter((l) => l.code).length + " 条" : ""));
  });

  $("#btnCopyAll").addEventListener("click", async () => {
    const text = state.netdisk.map((l) => l.providerName + " " + l.url + (l.code ? " 提取码：" + l.code : "")).join("\n");
    if (!text) return;
    await navigator.clipboard.writeText(text).catch(() => {});
    log("netdiskLog", "已复制全部 " + state.netdisk.length + " 条");
  });

  $("#btnExport").addEventListener("click", async () => {
    if (!state.netdisk.length) return;
    const dir = ((state.settings && state.settings.toolbox && state.settings.toolbox.articleDir) || "ZeroZen/阅读").replace(/\/+$/, "");
    const lines = state.netdisk.map((l) => "- " + l.providerName + "：" + l.url + (l.code ? "（提取码：" + l.code + "）" : ""));
    const md = "# 网盘资源（" + (state.title || "") + "）\n\n来源：" + state.url + "\n\n" + lines.join("\n") + "\n";
    const dataUrl = "data:text/markdown;charset=utf-8;base64," + btoa(unescape(encodeURIComponent(md)));
    try {
      await download(dataUrl, dir + "/" + sanitize(state.title || "网盘资源") + "-网盘资源.md");
      log("netdiskLog", "已导出到 " + dir);
    } catch (e) {
      log("netdiskLog", "× 导出失败：" + ((e && e.message) || e));
    }
  });

  $("#tsAsMp4").addEventListener("change", async () => {
    await UI.send({ type: "zz:settings:set", payload: { settings: { toolbox: { tsAsMp4: $("#tsAsMp4").checked } }, rebuild: false } });
  });
  $("#videoDir").addEventListener("change", async () => {
    await UI.send({ type: "zz:settings:set", payload: { settings: { toolbox: { videoDir: $("#videoDir").value.trim() } }, rebuild: false } });
  });
  $("#imageDir").addEventListener("change", async () => {
    await UI.send({ type: "zz:settings:set", payload: { settings: { toolbox: { imageDir: $("#imageDir").value.trim() } }, rebuild: false } });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") state.cancel = true;
  });

  // ---------- downloader ----------
  const dl = { items: [], filter: "all", speeds: new Map(), timer: null, changedBound: false };

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

  function basename(p) {
    return String(p || "").split(/[\\/]/).pop() || p;
  }

  function stateInfo(it) {
    if (it.state === "complete") return { label: "已完成", cls: "ok" };
    if (it.state === "interrupted") return { label: it.error === "USER_CANCELED" ? "已取消" : "失败：" + (it.error || "中断"), cls: "err" };
    if (it.paused) return { label: "已暂停", cls: "" };
    return { label: "下载中", cls: "" };
  }

  function dlSearch() {
    return new Promise((resolve) => api.downloads.search({ orderBy: ["-startTime"], limit: 300 }, resolve));
  }

  async function refreshDownloader() {
    const items = await dlSearch();
    const now = Date.now();
    for (const it of items) {
      const prev = dl.speeds.get(it.id);
      let speed = prev ? prev.speed : 0;
      if (prev && now > prev.at) {
        const inst = ((it.bytesReceived - prev.bytes) / ((now - prev.at) / 1000));
        if (inst > 0) speed = inst;
      }
      dl.speeds.set(it.id, { bytes: it.bytesReceived || 0, at: now, speed });
    }
    dl.items = items;
    renderDownloader();
  }

  function renderDownloader() {
    const box = $("#dlList");
    const q = ($("#dlQuery").value || "").toLowerCase();
    const items = dl.items.filter((it) => {
      if (dl.filter === "progressing" && it.state !== "in_progress") return false;
      if (dl.filter === "complete" && it.state !== "complete") return false;
      if (dl.filter === "failed" && it.state !== "interrupted") return false;
      if (q && !((it.filename || "").toLowerCase().includes(q) || (it.url || "").toLowerCase().includes(q))) return false;
      return true;
    });
    if (!items.length) {
      box.innerHTML = '<div class="zz-small zz-muted">没有下载任务。粘贴一个 http/https 直链开始下载。</div>';
      return;
    }
    box.innerHTML = items
      .map((it) => {
        const st = stateInfo(it);
        const total = it.totalBytes > 0 ? it.totalBytes : it.fileSize || 0;
        const pct = total ? Math.min(100, Math.round(((it.bytesReceived || 0) / total) * 100)) : it.state === "complete" ? 100 : 0;
        const speed = dl.speeds.get(it.id) || { speed: 0 };
        const meta = [
          basename((it.filename || "").replace(/[^\\/]+$/, "")) || "",
          total ? bytes(it.bytesReceived) + " / " + bytes(total) : bytes(it.bytesReceived),
          st.label,
        ];
        if (it.state === "in_progress" && speed.speed) meta.push(bytes(speed.speed) + "/s");
        if (it.state === "in_progress" && it.estimatedEndTime) meta.push("剩余 " + it.estimatedEndTime.slice(11, 16));
        const buttons = [];
        if (it.state === "in_progress" && !it.paused) buttons.push('<button class="zz-btn zz-btn-sm" data-act="pause">暂停</button>');
        if (it.state === "in_progress" && it.paused) buttons.push('<button class="zz-btn zz-btn-sm" data-act="resume">继续</button>');
        if (it.state === "in_progress") buttons.push('<button class="zz-btn zz-btn-sm" data-act="cancel">取消</button>');
        if (it.state === "complete") {
          buttons.push('<button class="zz-btn zz-btn-sm" data-act="open">打开</button>');
          buttons.push('<button class="zz-btn zz-btn-sm" data-act="folder">文件夹</button>');
        }
        if (it.state === "interrupted") buttons.push('<button class="zz-btn zz-btn-sm" data-act="retry">重试</button>');
        buttons.push('<button class="zz-btn zz-btn-sm" data-act="copy">链接</button>');
        buttons.push('<button class="zz-btn zz-btn-sm zz-btn-danger" data-act="remove">删除记录</button>');
        return (
          '<div class="zz-tool-item" data-id="' + it.id + '">' +
          '<div style="flex:1;min-width:0">' +
          '<div class="zz-small" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          basename(it.filename) +
          "</div>" +
          '<div class="zz-small zz-muted">' + meta.filter(Boolean).join(" · ") + "</div>" +
          '<div style="height:4px;border-radius:2px;background:rgba(127,127,127,.25);margin-top:4px">' +
          '<i style="display:block;height:100%;width:' + pct + "%;border-radius:2px;background:" + (st.cls === "err" ? "#dc2626" : "#3b82f6") + '"></i></div>' +
          "</div>" +
          buttons.join("") +
          "</div>"
        );
      })
      .join("");
  }

  $("#dlList").addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-act]");
    if (!btn) return;
    const row = btn.closest(".zz-tool-item");
    const id = Number(row.getAttribute("data-id"));
    const act = btn.getAttribute("data-act");
    const item = dl.items.find((x) => x.id === id);
    try {
      if (act === "pause") api.downloads.pause(id);
      else if (act === "resume") api.downloads.resume(id);
      else if (act === "cancel") api.downloads.cancel(id);
      else if (act === "open") api.downloads.open(id);
      else if (act === "folder") api.downloads.show(id);
      else if (act === "retry" && item) {
        const dir = (item.filename || "").replace(/[\\/][^\\/]*$/, "");
        await api.downloads.erase({ id });
        await download(item.url, dir + "/" + basename(item.filename || "download"));
      } else if (act === "copy" && item) {
        await navigator.clipboard.writeText(item.url).catch(() => {});
        btn.textContent = "已复制";
        setTimeout(() => (btn.textContent = "链接"), 1200);
      } else if (act === "remove") {
        await api.downloads.erase({ id });
      }
    } catch (e) {
      log("dlLog", "× 操作失败：" + ((e && e.message) || e));
    }
    setTimeout(refreshDownloader, 300);
  });

  $$("button[data-dlfilter]").forEach((btn) =>
    btn.addEventListener("click", () => {
      dl.filter = btn.getAttribute("data-dlfilter");
      renderDownloader();
    })
  );
  $("#dlQuery").addEventListener("input", renderDownloader);
  $("#btnDlRefresh").addEventListener("click", refreshDownloader);
  $("#btnDlClear").addEventListener("click", async () => {
    await api.downloads.erase({ state: "complete" });
    await refreshDownloader();
    log("dlLog", "已清除完成记录（文件保留）");
  });

  async function multiThreadDownload(url, name, dir, threads, onProgress) {
    const head = await fetch(url, { method: "HEAD", credentials: "include" });
    const len = Number(head.headers.get("content-length") || 0);
    const accept = head.headers.get("accept-ranges") || "";
    if (!len) throw new Error("服务器未返回文件大小");
    if (!/bytes/i.test(accept) && !(head.status === 206)) throw new Error("服务器不支持分段下载");
    if (len > 800 * 1024 * 1024) throw new Error("文件超过 800MB，请使用默认模式");
    const total = len;
    const chunk = Math.ceil(total / threads);
    const parts = new Array(threads);
    let received = 0;
    let cancelled = false;
    const tasks = Array.from({ length: threads }, async (_, i) => {
      const start = i * chunk;
      const end = Math.min(total - 1, start + chunk - 1);
      if (start > end) return;
      const res = await fetch(url, { headers: { Range: "bytes=" + start + "-" + end }, credentials: "include" });
      if (!res.ok && res.status !== 206) throw new Error("分片 HTTP " + res.status);
      const buf = new Uint8Array(await res.arrayBuffer());
      parts[i] = buf;
      received += buf.length;
      onProgress(received, total);
    });
    await Promise.all(tasks);
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
    const blob = new Blob(parts, { type: MIME[ext] || "application/octet-stream" });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await download(blobUrl, dir + "/" + name);
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    }
    return { size: total, cancelled };
  }

  $("#dlUrl").addEventListener("input", () => {
    if ($("#dlName").value.trim()) return;
    try {
      const base = decodeURIComponent((($("#dlUrl").value.trim().split(/[?#]/)[0] || "").split("/").pop() || ""));
      if (/\./.test(base)) $("#dlName").value = base.slice(0, 100);
    } catch (e) {}
  });

  $("#btnDlPaste").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) $("#dlUrl").value = text.trim();
    } catch (e) {
      log("dlLog", "无法读取剪贴板，请手动粘贴（Ctrl/Cmd+V）");
    }
  });

  $("#btnDlStart").addEventListener("click", async () => {
    const url = $("#dlUrl").value.trim();
    if (!/^https?:/i.test(url)) {
      log("dlLog", "请输入 http/https 下载地址");
      return;
    }
    const dir = ($("#dlDir").value || "ZeroZen/下载").replace(/\/+$/, "");
    let name = $("#dlName").value.trim();
    if (!name) {
      try {
        name = decodeURIComponent((url.split(/[?#]/)[0].split("/").pop() || "download").slice(0, 100));
      } catch (e) {
        name = "download";
      }
    }
    name = sanitize(name);
    $("#btnDlStart").disabled = true;
    try {
      if ($("#dlMulti").checked) {
        if (/\.m3u8/i.test(url)) {
          log("dlLog", "m3u8 请在「视频（m3u8）」标签里下载（支持自动选清晰度与解密）");
          return;
        }
        setLog("dlLog", "多线程下载中…");
        await multiThreadDownload(url, name, dir, Math.max(2, Math.min(8, Number($("#dlThreads").value) || 4)), (got, total) => {
          setLog("dlLog", "多线程 " + bytes(got) + " / " + bytes(total) + "（" + Math.round((got / total) * 100) + "%）");
        });
        log("dlLog", "多线程完成，已保存 " + dir + "/" + name);
      } else {
        await download(url, dir + "/" + name);
        log("dlLog", "已加入下载：" + dir + "/" + name);
      }
      $("#dlName").value = "";
    } catch (e) {
      log("dlLog", "× " + ((e && e.message) || e));
      if ($("#dlMulti").checked) {
        try {
          await download(url, dir + "/" + name);
          log("dlLog", "已改用默认模式加入下载");
        } catch (e2) {
          log("dlLog", "× 默认模式也失败：" + ((e2 && e2.message) || e2));
        }
      }
    } finally {
      $("#btnDlStart").disabled = false;
      setTimeout(refreshDownloader, 500);
    }
  });

  $("#dlDir").addEventListener("change", async () => {
    await UI.send({ type: "zz:settings:set", payload: { settings: { toolbox: { downloadDir: $("#dlDir").value.trim() || "ZeroZen/下载" } }, rebuild: false } });
  });

  function bindDownloadEvents() {
    if (dl.changedBound || !api.downloads.onChanged) return;
    dl.changedBound = true;
    api.downloads.onChanged.addListener(() => {
      clearTimeout(dl.timer);
      dl.timer = setTimeout(refreshDownloader, 600);
    });
    if (api.downloads.onCreated) api.downloads.onCreated.addListener(() => setTimeout(refreshDownloader, 600));
  }

  loadContext().then(() => {
    refreshStreams();
    $("#dlDir").value = (state.settings && state.settings.toolbox && state.settings.toolbox.downloadDir) || "ZeroZen/下载";
    bindDownloadEvents();
    refreshDownloader();
    setInterval(refreshDownloader, 2000);
  });
})();

(function () {
  const UI = globalThis.ZZUI;
  const $raw = UI.$;
  const $ = (sel) => (typeof sel === "string" && sel[0] !== "#" && sel[0] !== "." && sel[0] !== "[" ? $raw("#" + sel) : $raw(sel));
  const $$ = UI.$$;
  const T = UI.T;
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

  ZZDLEngine.init({ UI, T, referrerOf: () => state.url });
  const download = (...args) => ZZDLEngine.download(...args);


  async function proxy(type, payload) {
    return UI.send({ type: "zz:toolbox:proxy", payload: { tabId: state.tabId, type, payload } });
  }

  // ---------- context ----------
  async function loadContext() {
    const settings = await UI.send({ type: "zz:settings:get" });
    if (settings && settings.ok) {
      state.settings = settings.settings;
      $("#videoDir").value = (state.settings.toolbox && state.settings.toolbox.videoDir) || T("ZeroZen/视频");
      $("#imageDir").value = (state.settings.toolbox && state.settings.toolbox.imageDir) || T("ZeroZen/图片");
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
      $("#ctxLabel").textContent = T("找不到网页，请在网页上打开工具箱");
    }
    const payUrl = (state.settings && state.settings.honest && state.settings.honest.url) || "";
    $("#payLine").innerHTML =
      T("视频嗅探下载、图片发现、网盘资源收集均采用 <b>诚实付费</b>：免费使用，觉得好用请支持作者。") +
      (payUrl
        ? ' <a href="' + payUrl + '" target="_blank" rel="noreferrer">' + T("前往付费/打赏") + "</a>"
        : ' <span style="color:#d97706">' + T("（付费链接可在控制台「统计与诊断」里配置）") + "</span>");
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
        "<b>" + T("还没有发现视频流") + "</b>" +
        '<ol class="zz-small" style="margin:8px 0 0 18px;color:inherit">' +
        "<li>" + T("回到刚才的网页，先点一下播放（播几秒即可）") + "</li>" +
        "<li>" + T("再回到这里点「刷新嗅探」") + "</li>" +
        "<li>" + T("勾选流后点「下载选中」，文件会进浏览器下载目录的 ZeroZen/视频") + "</li>" +
        "</ol>" +
        '<div class="zz-tool-row" style="margin-top:10px"><input type="text" id="manualUrl" placeholder="' +
        T("或手动粘贴 m3u8 地址") +
        '" style="flex:1;min-width:280px" /><button class="zz-btn zz-btn-sm" id="btnAddUrl">' +
        T("添加") +
        "</button></div>" +
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
      '<div class="zz-tool-row"><input type="text" id="manualUrl" placeholder="' +
        T("手动粘贴 m3u8 地址") +
        '" style="flex:1;min-width:280px" /><button class="zz-btn zz-btn-sm" id="btnAddUrl">' +
        T("添加") +
        "</button></div>";
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
    for (const s of (sniff && sniff.streams) || []) map.set(s.url, { url: s.url, kind: s.kind, note: T("网络请求"), hits: s.hits || 1 });
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
    log("videoLog", T("共 $1 个流", state.streams.length));
    // 网络嗅探依赖可选的 webRequest 权限；缺失时静默失效，这里必须给出可见提示
    if (!(await UI.hasPermission("webRequest"))) {
      log("videoLog", T("提示：网络嗅探未开启（未授予「请求观察」权限），当前仅显示页面内发现的流。点「刷新嗅探」可立即授权。"));
    }
  }

  $("#btnStreams").addEventListener("click", async () => {
    // 按钮点击是用户手势，此时申请可选权限才会弹出确认框
    const granted = await UI.ensurePermission("webRequest");
    if (!granted) {
      setLog("videoLog", T("未授予「请求观察」权限，无法嗅探网络请求；也可到控制台「权限管理」里开启。"));
      return;
    }
    await refreshStreams();
  });



  $("#btnM3u8").addEventListener("click", async () => {
    const urls = Array.from(state.selected);
    if (!urls.length) {
      setLog("videoLog", T("请先勾选一个流"));
      return;
    }
    const title = sanitize($("#videoTitle").value || state.title || "video");
    const dir = ($("#videoDir").value || T("ZeroZen/视频")).replace(/\/+$/, "");
    const tsAsMp4 = $("#tsAsMp4").checked;
    state.cancel = false;
    $("#btnM3u8").disabled = true;
    $("#btnVideoCancel").disabled = false;
    setLog("videoLog", T("开始下载：$1 个流", urls.length));
    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const nameBase = title + (urls.length > 1 ? " (" + (i + 1) + ")" : "");
        try {
          const res = await ZZDLEngine.downloadM3u8(url, {
            concurrency: Math.max(1, Math.min(12, Number($("#videoThreads").value) || 6)),
            onProgress: (t) => log("videoLog", t),
            isCancelled: () => state.cancel,
            nameBase,
            dir,
            tsAsMp4,
          });
          if (res.cancelled) {
            log("videoLog", T("已取消，进度已保留，可在「下载器」里继续"));
            break;
          }
          log("videoLog", T("已保存 $1（$2 MB）", res.saved, Math.round((res.size / 1048576) * 10) / 10));
        } catch (e) {
          // 单个流失败（进度已保留）不阻断后面的流
          log("videoLog", "× " + T("失败：$1", (e && e.message) || e));
          log("videoLog", T("进度已保留，可在「下载器」里继续"));
        }
      }
    } finally {
      $("#btnM3u8").disabled = false;
      $("#btnVideoCancel").disabled = true;
      refreshResumes();
    }
  });

  $("#videoThreads").addEventListener("change", async () => {
    await UI.send({
      type: "zz:settings:set",
      payload: { settings: { toolbox: { concurrency: Math.max(1, Math.min(12, Number($("#videoThreads").value) || 6)) } }, rebuild: false },
    });
  });

  $("#btnVideoCancel").addEventListener("click", () => {
    state.cancel = true;
    log("videoLog", T("正在取消…"));
  });

  // ---------- images ----------
  function updateImgInfo() {
    $("#imgInfo").textContent = T("共发现 $1 张，已选 $2 张", state.images.length, state.imageSelected.size);
  }

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
    updateImgInfo();
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
        updateImgInfo();
      })
    );
    updateImgInfo();
  }

  $("#btnImages").addEventListener("click", async () => {
    const res = await proxy("zz:toolbox:images");
    if (!res || !res.ok) {
      setLog("imageLog", T("扫描失败：$1", (res && res.error) || T("无法连接页面")));
      return;
    }
    state.images = res.images || [];
    state.imageSelected.clear();
    state.formats.clear();
    if (res.title && !$("#videoTitle").value) $("#videoTitle").value = res.title;
    renderImages();
    setLog("imageLog", T("扫描到 $1 张图片", state.images.length));
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
    const dir = ($("#imageDir").value || T("ZeroZen/图片")).replace(/\/+$/, "");
    const list = Array.from(state.imageSelected).map((i) => state.images[i]).filter(Boolean);
    if (!list.length) {
      setLog("imageLog", T("请先勾选图片"));
      return;
    }
    setLog("imageLog", T("开始下载 $1 张…", list.length));
    let ok = 0;
    for (const img of list) {
      const base = (img.url.split(/[?#]/)[0].split("/").pop() || "image").slice(0, 60);
      const name = sanitize(base.includes(".") ? base : base + "." + (img.format === "other" ? "jpg" : img.format));
      try {
        await download(img.url, dir + "/" + name);
        ok++;
        if (ok % 10 === 0) log("imageLog", T("已下载 $1/$2", ok, list.length));
      } catch (e) {
        log("imageLog", "× " + name + "：" + ((e && e.message) || e));
      }
    }
    log("imageLog", T("完成：成功 $1 / $2", ok, list.length));
  });

  // ---------- netdisk ----------
  function renderNetdisk() {
    const box = $("#netdiskList");
    if (!state.netdisk.length) {
      box.innerHTML = '<div class="zz-small zz-muted">' + T("没有发现网盘链接。") + "</div>";
      return;
    }
    box.innerHTML = state.netdisk
      .map(
        (l, i) =>
          '<div class="zz-tool-item"><span class="zz-tag">' + l.providerName + "</span>" +
          '<span class="url">' + l.url.slice(0, 110) + "</span>" +
          (l.code ? '<span class="code">' + T("提取码 $1", l.code) + "</span>" : "") +
          '<button class="zz-btn zz-btn-sm" data-copy="' + i + '">' + T("复制") + "</button>" +
          '<button class="zz-btn zz-btn-sm" data-open="' + i + '">' + T("打开") + "</button></div>"
      )
      .join("");
    box.querySelectorAll("button[data-copy]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const l = state.netdisk[Number(btn.getAttribute("data-copy"))];
        const text = l.url + (l.code ? T(" 提取码：$1", l.code) : "");
        await navigator.clipboard.writeText(text).catch(() => {});
        btn.textContent = T("已复制");
        setTimeout(() => (btn.textContent = T("复制")), 1500);
      })
    );
    box.querySelectorAll("button[data-open]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const l = state.netdisk[Number(btn.getAttribute("data-open"))];
        api.tabs.create({ url: l.url });
      })
    );
  }

  // ---------- 误拦反馈 ----------
  function escapeToolHtml(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  function renderMisfires() {
    const box = $("#misfireList");
    const list = state.misfires || [];
    if (!list.length) {
      box.innerHTML = '<div class="zz-small zz-muted">' + T("没有扫描到被隐藏的元素。") + "</div>";
      return;
    }
    box.innerHTML = list
      .map(
        (m, i) =>
          '<div class="zz-tool-item"><span class="zz-tag">' + T("隐藏规则") + "</span>" +
          '<span class="url">' + escapeToolHtml(m.summary) + '<br /><span class="zz-small zz-muted">' + escapeToolHtml(m.selector) + "</span></span>" +
          '<button class="zz-btn zz-btn-sm" data-misallow="' + i + '">' + T("放行") + "</button></div>"
      )
      .join("");
    box.querySelectorAll("button[data-misallow]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const m = state.misfires[Number(btn.getAttribute("data-misallow"))];
        if (!m) return;
        const host = (state.url && new URL(state.url).hostname) || m.host || "";
        const res = await UI.send({
          type: "zz:picker:allow",
          payload: { selector: m.selector, scope: "site", host, note: T("误拦反馈放行") },
        });
        if (res && res.ok) {
          btn.textContent = T("已放行");
          btn.disabled = true;
          setLog("misfireLog", T("已放行：$1（稍候页面自动恢复显示）", m.summary));
          setTimeout(loadMisfires, 1200);
        } else {
          setLog("misfireLog", T("放行失败：$1", (res && res.error) || T("未知错误")));
        }
      })
    );
  }

  async function loadMisfires() {
    if (!state.tabId) {
      setLog("misfireLog", T("找不到网页，请在网页上打开工具箱"));
      return;
    }
    const res = await proxy("zz:toolbox:misfires");
    if (!res || !res.ok) {
      setLog("misfireLog", T("扫描失败：$1", (res && res.error) || T("无法连接页面")));
      return;
    }
    state.misfires = (res.misfires || []).map((m) => Object.assign({ host: res.host }, m));
    renderMisfires();
    setLog("misfireLog", T("命中 $1 条隐藏规则", state.misfires.length));
  }

  $("#btnMisfireScan").addEventListener("click", loadMisfires);

  $("#btnNetdisk").addEventListener("click", async () => {    const res = await proxy("zz:toolbox:netdisk");
    if (!res || !res.ok) {
      setLog("netdiskLog", T("扫描失败：$1", (res && res.error) || T("无法连接页面")));
      return;
    }
    state.netdisk = res.links || [];
    renderNetdisk();
    setLog(
      "netdiskLog",
      T("发现 $1 条资源", state.netdisk.length) +
        (state.netdisk.length ? T("，含提取码 $1 条", state.netdisk.filter((l) => l.code).length) : "")
    );
  });

  $("#btnCopyAll").addEventListener("click", async () => {
    const text = state.netdisk
      .map((l) => l.providerName + " " + l.url + (l.code ? T(" 提取码：$1", l.code) : ""))
      .join("\n");
    if (!text) return;
    await navigator.clipboard.writeText(text).catch(() => {});
    log("netdiskLog", T("已复制全部 $1 条", state.netdisk.length));
  });

  $("#btnExport").addEventListener("click", async () => {
    if (!state.netdisk.length) return;
    const dir = ((state.settings && state.settings.toolbox && state.settings.toolbox.articleDir) || T("ZeroZen/阅读")).replace(/\/+$/, "");
    const lines = state.netdisk.map(
      (l) => "- " + l.providerName + "：" + l.url + (l.code ? T("（提取码：$1）", l.code) : "")
    );
    const md =
      "# " + T("网盘资源（$1）", state.title || "") + "\n\n" + T("来源：$1", state.url) + "\n\n" + lines.join("\n") + "\n";
    const dataUrl = "data:text/markdown;charset=utf-8;base64," + btoa(unescape(encodeURIComponent(md)));
    try {
      await download(dataUrl, dir + "/" + sanitize(state.title || T("网盘资源")) + "-" + T("网盘资源") + ".md");
      log("netdiskLog", T("已导出到 $1", dir));
    } catch (e) {
      log("netdiskLog", "× " + T("导出失败：$1", (e && e.message) || e));
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
    if (it.state === "complete") return { label: T("已完成"), cls: "ok" };
    if (it.state === "interrupted") {
      if (it.error === "USER_CANCELED") return { label: T("已取消"), cls: "err" };
      const hint = ZZDLEngine.errorHint({ error: it.error });
      return { label: T("失败：$1", hint.reason), hint, cls: "err" };
    }
    if (it.paused) return { label: T("已暂停"), cls: "" };
    return { label: T("下载中"), cls: "" };
  }

  function dlSearch() {
    if (!api.downloads || !api.downloads.search) return Promise.resolve([]);
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
    const sortMode = ($("#dlSort") && $("#dlSort").value) || "time";
    const items = dl.items.filter((it) => {
      if (dl.filter === "progressing" && it.state !== "in_progress") return false;
      if (dl.filter === "complete" && it.state !== "complete") return false;
      if (dl.filter === "failed" && it.state !== "interrupted") return false;
      if (q && !((it.filename || "").toLowerCase().includes(q) || (it.url || "").toLowerCase().includes(q))) return false;
      return true;
    });
    const stateOrder = { in_progress: 0, interrupted: 1, complete: 2 };
    const byName = (a, b) => String(basename(a.filename)).localeCompare(String(basename(b.filename)), "zh-Hans-CN", { numeric: true });
    if (sortMode === "size") items.sort((a, b) => (b.totalBytes || b.fileSize || 0) - (a.totalBytes || a.fileSize || 0) || byName(a, b));
    else if (sortMode === "name") items.sort(byName);
    else if (sortMode === "state") items.sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || byName(a, b));
    else if (sortMode === "speed")
      items.sort((a, b) => {
        const sa = (dl.speeds.get(a.id) || {}).speed || 0;
        const sb = (dl.speeds.get(b.id) || {}).speed || 0;
        return sb - sa || byName(a, b);
      });
    if (!items.length) {
      box.innerHTML = '<div class="zz-small zz-muted">' + T("没有下载任务。粘贴一个 http/https 直链开始下载。") + "</div>";
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
          total ? bytes(it.bytesReceived) + " / " + bytes(total) + (pct ? "（" + pct + "%）" : "") : bytes(it.bytesReceived),
          st.label,
        ];
        if (it.state === "in_progress" && speed.speed) meta.push(bytes(speed.speed) + "/s");
        if (it.state === "in_progress" && it.estimatedEndTime) meta.push(T("剩余 $1", it.estimatedEndTime.slice(11, 16)));
        const buttons = [];
        if (it.state === "in_progress" && !it.paused) buttons.push('<button class="zz-btn zz-btn-sm" data-act="pause">' + T("暂停") + "</button>");
        if (it.state === "in_progress" && it.paused) buttons.push('<button class="zz-btn zz-btn-sm" data-act="resume">' + T("继续") + "</button>");
        if (it.state === "in_progress") buttons.push('<button class="zz-btn zz-btn-sm" data-act="cancel">' + T("取消") + "</button>");
        if (it.state === "complete") {
          buttons.push('<button class="zz-btn zz-btn-sm" data-act="open">' + T("打开") + "</button>");
          buttons.push('<button class="zz-btn zz-btn-sm" data-act="folder">' + T("文件夹") + "</button>");
        }
        if (it.state === "interrupted") {
          buttons.push('<button class="zz-btn zz-btn-sm" data-act="retry">' + T("重试") + "</button>");
          buttons.push('<button class="zz-btn zz-btn-sm zz-btn-danger" data-act="report">' + T("反馈") + "</button>");
        }
        buttons.push('<button class="zz-btn zz-btn-sm" data-act="copy">' + T("链接") + "</button>");
        if (it.filename) buttons.push('<button class="zz-btn zz-btn-sm" data-act="copypath">' + T("路径") + "</button>");
        buttons.push('<button class="zz-btn zz-btn-sm zz-btn-danger" data-act="remove">' + T("删除记录") + "</button>");
        return (
          '<div class="zz-tool-item" data-id="' + it.id + '">' +
          '<div style="flex:1;min-width:0">' +
          '<div class="zz-small" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
          escapeHtmlAttr(it.filename) +
          '">' +
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

  function escapeHtmlAttr(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  async function reportDownload(it) {
    const hint = ZZDLEngine.errorHint({ error: it.error });
    const report = ZZDLEngine.buildReport({
      url: it.url,
      filename: it.filename,
      hint,
      totalBytes: it.totalBytes || it.fileSize || 0,
    });
    try {
      await navigator.clipboard.writeText(report);
    } catch (e) {}
    api.tabs.create({ url: ZZDLEngine.issueUrl(report) });
    log("dlLog", T("诊断报告已复制，已在 GitHub 打开反馈页，粘贴到正文即可"));
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
        btn.textContent = T("已复制");
        setTimeout(() => (btn.textContent = T("链接")), 1200);
      } else if (act === "copypath" && item) {
        await navigator.clipboard.writeText(item.filename || "").catch(() => {});
        btn.textContent = T("已复制");
        setTimeout(() => (btn.textContent = T("路径")), 1200);
      } else if (act === "report" && item) {
        await reportDownload(item);
      } else if (act === "remove") {
        await api.downloads.erase({ id });
      }
    } catch (e) {
      log("dlLog", "× " + T("操作失败：$1", (e && e.message) || e));
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
    log("dlLog", T("已清除完成记录（文件保留）"));
  });


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
      log("dlLog", T("无法读取剪贴板，请手动粘贴（Ctrl/Cmd+V）"));
    }
  });

  $("#btnDlStart").addEventListener("click", async () => {
    const url = $("#dlUrl").value.trim();
    if (!/^https?:/i.test(url)) {
      log("dlLog", T("请输入 http/https 下载地址"));
      return;
    }
    const dir = ($("#dlDir").value || T("ZeroZen/下载")).replace(/\/+$/, "");
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
          log("dlLog", T("m3u8 请在「视频（m3u8）」标签里下载（支持自动选清晰度与解密）"));
          return;
        }
        state.cancel = false;
        setLog("dlLog", T("多线程下载中…"));
        const res = await ZZDLEngine.multiThreadDownload(
          url,
          name,
          dir,
          Math.max(2, Math.min(8, Number($("#dlThreads").value) || 4)),
          (got, total) => {
            setLog("dlLog", T("多线程 $1 / $2（$3%）", bytes(got), bytes(total), Math.round((got / total) * 100)));
          },
          () => state.cancel
        );
        if (res.cancelled) {
          log("dlLog", T("已取消，进度已保留，可稍后继续"));
        } else {
          log("dlLog", T("多线程完成，已保存 $1", res.saved));
          $("#dlName").value = "";
        }
      } else {
        await download(url, dir + "/" + name);
        log("dlLog", T("已加入下载：$1", dir + "/" + name));
        $("#dlName").value = "";
      }
    } catch (e) {
      log("dlLog", "× " + ((e && e.message) || e));
      log("dlLog", T("进度已保留，可稍后继续；也可取消勾选「多线程分段」改用浏览器默认下载"));
    } finally {
      $("#btnDlStart").disabled = false;
      refreshResumes();
      setTimeout(refreshDownloader, 500);
    }
  });

  $("#dlDir").addEventListener("change", async () => {
    await UI.send({ type: "zz:settings:set", payload: { settings: { toolbox: { downloadDir: $("#dlDir").value.trim() || T("ZeroZen/下载") } }, rebuild: false } });
  });

  function bindDownloadEvents() {
    if (dl.changedBound || !api.downloads || !api.downloads.onChanged) return;
    dl.changedBound = true;
    api.downloads.onChanged.addListener(() => {
      clearTimeout(dl.timer);
      dl.timer = setTimeout(refreshDownloader, 600);
    });
    if (api.downloads.onCreated) api.downloads.onCreated.addListener(() => setTimeout(refreshDownloader, 600));
  }

  // ---------- 断点续传任务列表 ----------
  const resumes = { items: [], busy: new Set() };

  async function refreshResumes() {
    if (!globalThis.ZZDLStore) return;
    try {
      resumes.items = await ZZDLStore.listTasks();
    } catch (e) {
      return;
    }
    renderResumes();
  }

  function resumeMeta(task) {
    const kindLabel = task.kind === "m3u8" ? T("视频（m3u8）") : T("多线程分段");
    let pct = 0;
    let progressText = "";
    if (task.kind === "m3u8") {
      pct = task.total ? Math.min(100, Math.round(((task.done || 0) / task.total) * 100)) : 0;
      progressText = T("分片 $1/$2", task.done || 0, task.total || 0);
    } else {
      pct = task.total ? Math.min(100, Math.round(((task.done || 0) / task.total) * 100)) : 0;
      progressText = bytes(task.done || 0) + " / " + bytes(task.total);
    }
    let status;
    if (task.status === "error") status = T("失败：$1", task.error || T("中断"));
    else status = T("已暂停");
    const name = task.kind === "m3u8" ? task.nameBase : task.name;
    return { kindLabel, pct, progressText, status, name };
  }

  function renderResumes() {
    const box = $("#resumeList");
    if (!box) return;
    if (!resumes.items.length) {
      box.innerHTML = '<div class="zz-small zz-muted">' + T("暂无未完成任务。") + "</div>";
      return;
    }
    box.innerHTML = resumes.items
      .map((task) => {
        const m = resumeMeta(task);
        const busy = resumes.busy.has(task.id);
        const buttons = busy
          ? '<span class="zz-small zz-muted">' + T("下载中") + "</span>"
          : '<button class="zz-btn zz-btn-sm zz-btn-primary" data-ract="resume">' + T("继续") + "</button>";
        return (
          '<div class="zz-tool-item" data-rid="' + task.id + '">' +
          '<div style="flex:1;min-width:0">' +
          '<div class="zz-small" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          m.name +
          "</div>" +
          '<div class="zz-small zz-muted">' + [m.kindLabel, m.progressText, m.status].filter(Boolean).join(" · ") + "</div>" +
          '<div style="height:4px;border-radius:2px;background:rgba(127,127,127,.25);margin-top:4px">' +
          '<i style="display:block;height:100%;width:' + m.pct + "%;border-radius:2px;background:" + (task.status === "error" ? "#dc2626" : "#3b82f6") + '"></i></div>' +
          "</div>" +
          buttons +
          '<button class="zz-btn zz-btn-sm zz-btn-danger" data-ract="drop" ' + (busy ? "disabled" : "") + ">" + T("删除") + "</button>" +
          "</div>"
        );
      })
      .join("");
  }

  $("#resumeList").addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-ract]");
    if (!btn) return;
    const row = btn.closest(".zz-tool-item");
    const id = row.getAttribute("data-rid");
    const task = resumes.items.find((x) => x.id === id);
    if (!task) return;
    const act = btn.getAttribute("data-ract");
    try {
      if (act === "drop") {
        await ZZDLStore.removeTask(id);
        await refreshResumes();
        log("dlLog", T("已删除未完成任务与已下载分片"));
        return;
      }
      if (act !== "resume" || resumes.busy.has(id)) return;
      resumes.busy.add(id);
      state.cancel = false;
      renderResumes();
      try {
        if (task.kind === "m3u8") {
          const res = await ZZDLEngine.downloadM3u8(task.url, {
            concurrency: Math.max(1, Math.min(12, task.concurrency || 6)),
            onProgress: (t) => log("dlLog", t),
            isCancelled: () => state.cancel,
            nameBase: task.nameBase,
            dir: task.dir,
            tsAsMp4: !!task.tsAsMp4,
          });
          if (!res.cancelled) log("dlLog", T("已保存 $1（$2 MB）", res.saved, Math.round((res.size / 1048576) * 10) / 10));
          else log("dlLog", T("已取消，进度已保留，可稍后继续"));
        } else {
          const res = await ZZDLEngine.multiThreadDownload(
            task.url,
            task.name,
            task.dir,
            task.threads || 4,
            (got, total) => {
              log("dlLog", T("多线程 $1 / $2（$3%）", bytes(got), bytes(total), Math.round((got / total) * 100)));
            },
            () => state.cancel
          );
          if (!res.cancelled) log("dlLog", T("多线程完成，已保存 $1", res.saved));
          else log("dlLog", T("已取消，进度已保留，可稍后继续"));
        }
      } finally {
        resumes.busy.delete(id);
        await refreshResumes();
      }
    } catch (e) {
      log("dlLog", "× " + T("失败：$1", (e && e.message) || e));
      log("dlLog", T("进度已保留，可稍后继续"));
      resumes.busy.delete(id);
      await refreshResumes();
    }
  });

  // ---------- 下载任务队列执行器 ----------
  // popup 创建的任务以 queued 记录入队；工具箱页面（常驻标签页）负责真正执行，
  // popup 关闭不影响下载。同一任务不会被重复执行。
  const queueState = { running: new Set() };

  async function runTaskById(id) {
    if (!globalThis.ZZDLStore || queueState.running.has(id)) return { ok: false, error: "busy-or-missing" };
    const record = await ZZDLStore.getTask(id);
    if (!record) return { ok: false, error: "not found" };
    queueState.running.add(id);
    try {
      let res;
      if (record.kind === "m3u8") {
        res = await ZZDLEngine.downloadM3u8(record.url, {
          concurrency: Math.max(1, Math.min(12, record.concurrency || 6)),
          nameBase: record.nameBase || sanitize(record.name || "video"),
          dir: record.dir || "ZeroZen/视频",
          tsAsMp4: !!record.tsAsMp4,
          onProgress: (t) => log("dlLog", (record.nameBase || record.name || "") + " " + t),
        });
      } else {
        res = await ZZDLEngine.multiThreadDownload(
          record.url,
          record.name || "download",
          record.dir || "ZeroZen/下载",
          Math.max(2, Math.min(8, record.threads || 4)),
          (got, total) => {
            if (total) log("dlLog", (record.name || "") + " " + T("多线程 $1 / $2（$3%）", bytes(got), bytes(total), Math.round((got / total) * 100)));
          },
          null
        );
      }
      // 队列条目（queued:true）执行完即清理；引擎自己的续传 meta 由引擎管理
      if (record.queued) await ZZDLStore.removeTask(id);
      if (!res || !res.cancelled) {
        log("dlLog", T("任务完成：$1", (res && res.saved) || record.name || id));
        refreshDownloader();
      }
      return { ok: true, cancelled: !!(res && res.cancelled) };
    } catch (e) {
      log("dlLog", "× " + T("失败：$1", (e && e.message) || e) + (record.queued ? "" : "") + "（" + T("进度已保留，可稍后继续") + "）");
      if (record.queued) {
        // 队列条目转为 error 留在「未完成任务」列表，可继续/删除
        record.status = "error";
        record.error = String((e && e.message) || e);
        await ZZDLStore.putTask(record);
      }
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      queueState.running.delete(id);
      refreshResumes();
    }
  }

  let queueDraining = false;
  async function drainQueue() {
    if (queueDraining || !globalThis.ZZDLStore) return;
    queueDraining = true;
    try {
      const tasks = await ZZDLStore.listTasks();
      for (const t of tasks) {
        if (!t.queued || t.status !== "queued") continue;
        await runTaskById(t.id);
      }
    } catch (e) {
    } finally {
      queueDraining = false;
    }
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "zz:dl:run") {
      runTaskById((msg.payload && msg.payload.taskId) || "").then(sendResponse);
      return true;
    }
    return false;
  });

  UI.initLocale()
    .then(() => loadContext())
    .then(() => {
      refreshStreams();
      $("#dlDir").value = (state.settings && state.settings.toolbox && state.settings.toolbox.downloadDir) || T("ZeroZen/下载");
      bindDownloadEvents();
      refreshDownloader();
      setInterval(refreshDownloader, 2000);
      refreshResumes();
      setInterval(refreshResumes, 5000);
      drainQueue(); // 启动即消化 popup 创建的排队任务
      setInterval(drainQueue, 15000);
    });
})();

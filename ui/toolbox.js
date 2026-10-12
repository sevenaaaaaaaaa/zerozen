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
    // 画质覆盖：m3u8 地址 → 选中的媒体列表地址（"" = 自动选最高）
    quality: {},
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

  // 任务完成系统通知：控制台开了开关且已授予「通知」权限才会发；实时读设置，开关后无需重开工具箱
  async function notifyDone(ok, what) {
    try {
      const res = await UI.send({ type: "zz:settings:get" });
      const tb = res && res.ok && res.settings && res.settings.toolbox;
      if (!tb || !tb.notifyDone) return;
      if (!(await UI.hasPermission("notifications"))) return;
      await api.notifications.create({
        type: "basic",
        iconUrl: api.runtime.getURL("icons/icon128.png"),
        title: ok ? T("ZeroZen 任务完成") : T("ZeroZen 任务失败"),
        message: what,
      });
    } catch (e) {}
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

  // 图片 / 网盘清单导出：直接交给浏览器下载（视频下载统一走下载中心）
  async function download(url, filename) {
    if (!(await UI.ensurePermission("downloads"))) throw new Error(T("需要授予「下载」权限"));
    return new Promise((resolve, reject) => {
      try {
        const ret = api.downloads.download({ url, filename: filename.replace(/^\/+/, ""), conflictAction: "uniquify" }, (id) => {
          const err = api.runtime.lastError;
          if (err || id === undefined) reject(new Error((err && err.message) || "download failed"));
          else resolve(id);
        });
        if (ret && typeof ret.then === "function") ret.then(resolve, reject);
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
      $("#imageDir").value = (state.settings.toolbox && state.settings.toolbox.imageDir) || T("ZeroZen/图片");
    }
    const res = await UI.send({ type: "zz:toolbox:context", payload: { tabId: ctxTabId() } });
    if (res && res.ok) {
      state.tabId = res.tabId;
      state.title = stripSiteName(res.title, res.url);
      state.url = res.url;
      $("#ctxLabel").textContent = (res.title || res.url || "").slice(0, 48);
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
  // 记住上次停留的页签：切页时写入 storage.local，下次打开工具箱恢复
  const TAB_KEY = "zz.toolbox.tab";
  function activateTab(btn) {
    $$(".zz-tool-tab").forEach((b) => b.classList.toggle("active", b === btn));
    $$(".zz-tool-panel").forEach((p) => p.classList.toggle("active", p.id === "view-" + btn.getAttribute("data-view")));
    try {
      api.storage.local.set({ [TAB_KEY]: btn.getAttribute("data-view") });
    } catch (e) {}
  }
  $$(".zz-tool-tab").forEach((btn) => btn.addEventListener("click", () => activateTab(btn)));

  async function restoreTab() {
    let last = "";
    try {
      const res = await api.storage.local.get(TAB_KEY);
      last = (res && res[TAB_KEY]) || "";
    } catch (e) {}
    if (!last) return;
    const btn = $$('.zz-tool-tab[data-view="' + last + '"]')[0];
    if (btn && !btn.classList.contains("active")) activateTab(btn);
  }

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

  $("#imageDir").addEventListener("change", async () => {
    await UI.send({ type: "zz:settings:set", payload: { settings: { toolbox: { imageDir: $("#imageDir").value.trim() } }, rebuild: false } });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") state.cancel = true;
  });

  UI.initLocale()
    .then(() => loadContext())
    .then(() => {
      restoreTab();
      // 视频页签：与弹窗同一套媒体列表与任务卡片，任务都在下载中心统一管理
      const media = ZZDLUI.mediaList($("#streamList"), { tabId: state.tabId, toastEl: $("#videoMsg") });
      media.refresh();
      ZZDLUI.taskList($("#videoTasks"), { compact: true, toastEl: $("#videoMsg") });
      $("#btnStreams").addEventListener("click", () => media.refresh());
      $("#btnCenter").addEventListener("click", () => UI.send({ type: "zz:dl:open-center" }));
    });
})();

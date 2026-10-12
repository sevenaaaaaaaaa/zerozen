// 下载中心：所有下载任务的唯一入口（HLS 任务 + 浏览器原生直链下载）
(function () {
  const UI = globalThis.ZZUI;
  const $ = UI.$;
  const T = UI.T;
  const E = globalThis.ZZDLEngine;
  const msg = () => $("#msg");

  const FILTERS = {
    all: () => true,
    active: (t) => t.status === "running" || t.status === "queued" || t.status === "paused",
    done: (t) => t.status === "done",
    error: (t) => t.status === "error" || t.status === "canceled",
  };

  let list = null;

  function counts(tasks) {
    $("#nAll").textContent = tasks.length;
    $("#nActive").textContent = tasks.filter(FILTERS.active).length;
    $("#nDone").textContent = tasks.filter(FILTERS.done).length;
    $("#nError").textContent = tasks.filter(FILTERS.error).length;
    const box = $("#taskList");
    $("#cacheInfo").textContent = box._cacheBytes ? T("未完成任务缓存占用 $1", E.bytes(box._cacheBytes)) : "";
    const running = tasks.filter((t) => t.status === "running").length;
    document.title = (running ? "(" + running + ") " : "") + T("ZeroZen 下载中心");
  }

  async function loadSettings() {
    const tb = await ZZDLUI.settings();
    $("#sMax").value = tb.maxTasks || 2;
    $("#sConc").value = tb.concurrency || 6;
    $("#sDir").value = tb.videoDir || T("ZeroZen/视频");
    $("#sKeepTs").checked = tb.keepTs === true;
    $("#sNotify").checked = !!tb.notifyDone;
  }

  async function saveSettings(patch) {
    await UI.send({ type: "zz:settings:set", payload: { settings: { toolbox: patch }, rebuild: false } });
    await UI.send({ type: "zz:dl:config" });
    UI.toast(msg(), T("已保存"), "ok");
  }

  function bindSettings() {
    $("#sMax").addEventListener("change", (e) => saveSettings({ maxTasks: Math.max(1, Math.min(5, Number(e.target.value) || 2)) }));
    $("#sConc").addEventListener("change", (e) => saveSettings({ concurrency: Math.max(1, Math.min(12, Number(e.target.value) || 6)) }));
    $("#sDir").addEventListener("change", (e) => saveSettings({ videoDir: String(e.target.value || "").trim().replace(/^\/+|\/+$/g, "") || T("ZeroZen/视频") }));
    $("#sKeepTs").addEventListener("change", (e) => saveSettings({ keepTs: e.target.checked, tsAsMp4: !e.target.checked }));
    $("#sNotify").addEventListener("change", async (e) => {
      if (e.target.checked && !(await UI.ensurePermission("notifications"))) {
        e.target.checked = false;
        return;
      }
      saveSettings({ notifyDone: e.target.checked });
    });
  }

  async function addUrl(url) {
    url = String(url || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      UI.toast(msg(), T("请输入 http/https 地址"), "err");
      return;
    }
    if (!(await UI.ensurePermission("downloads"))) {
      UI.toast(msg(), T("需要「下载」权限才能保存文件"), "err");
      return;
    }
    const tb = await ZZDLUI.settings();
    const isHls = /\.m3u8(\?|#|$)/i.test(url) || /m3u8/i.test(url);
    const res = isHls
      ? await UI.send({ type: "zz:dl:add", payload: { url, title: E.nameFromUrl(url), dir: tb.videoDir || "ZeroZen/视频" } })
      : await UI.send({ type: "zz:dl:add-file", payload: { url, dir: E.dirForType(E.classifyExt(url), { video: tb.videoDir, audio: tb.audioDir, image: tb.imageDir, archive: tb.archiveDir, doc: tb.docDir, other: tb.downloadDir }) } });
    if (res && res.ok) {
      $("#addUrl").value = "";
      UI.toast(msg(), res.duplicate ? T("这个地址已在下载列表里") : T("已添加"), "ok");
      list.refresh();
    } else UI.toast(msg(), T("添加失败：$1", (res && res.error) || T("未知错误")), "err");
  }

  async function init() {
    await UI.initLocale();
    list = ZZDLUI.taskList($("#taskList"), {
      toastEl: msg(),
      emptyText: T("还没有下载任务。在视频页面点击工具栏的 ZeroZen 图标，就能看到可下载的视频。"),
      onChange: counts,
    });
    $("#filters").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-f]");
      if (!b) return;
      for (const x of document.querySelectorAll("#filters button")) x.classList.toggle("active", x === b);
      list.setFilter(FILTERS[b.getAttribute("data-f")]);
    });
    $("#addForm").addEventListener("submit", (e) => {
      e.preventDefault();
      addUrl($("#addUrl").value);
    });
    $("#btnClearDone").addEventListener("click", async () => {
      await UI.send({ type: "zz:dl:clear-done" });
      list.refresh();
    });
    $("#btnClearCache").addEventListener("click", async (e) => {
      e.preventDefault();
      await UI.send({ type: "zz:dl:clear-cache" });
      list.refresh();
      UI.toast(msg(), T("已清理"), "ok");
    });
    $("#btnFolder").addEventListener("click", async () => {
      if (!(await UI.ensurePermission("downloads"))) return;
      const r = await UI.send({ type: "zz:dl:show", payload: {} });
      if (r && !r.ok) UI.toast(msg(), r.error || T("操作失败"), "err");
    });
    bindSettings();
    loadSettings();
  }

  init();
})();

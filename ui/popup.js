(function () {
  const UI = globalThis.ZZUI;
  const $ = UI.$;
  const T = UI.T;
  const api = globalThis.ZZ.browser;

  ZZDLEngine.init({ UI, T, referrerOf: () => (tab && tab.url) || "" });

  let tab = null;
  let host = "";
  let refreshTimer = null;
  let mediaStreams = [];
  let taskFilter = "all";

  function bumpStat(id, value) {
    const el = $(id);
    const next = String(value == null ? 0 : value);
    if (!el || el.textContent === next) return;
    el.textContent = next;
    el.classList.remove("zz-bump");
    void el.offsetWidth; // 重启动画
    el.classList.add("zz-bump");
  }

  function renderState(state) {
    const c = state.counts || {};
    bumpStat("#statHidden", (c.cosmetic || 0) + (c.texts || 0) + (c.removed || 0));
    bumpStat("#statNetwork", c.network || 0);
    bumpStat("#statPopups", c.popups || 0);
    $("#globalEnabled").checked = !!state.enabled;
    $("#siteEnabled").checked = !!state.siteEnabled;
    lastState = state;
    const profile = state.profile || state.globalProfile || "standard";
    for (const btn of document.querySelectorAll("#profileSeg .zz-seg-btn")) {
      btn.classList.toggle("active", btn.getAttribute("data-profile") === profile);
      btn.disabled = !state.enabled;
    }
    const sourceLabel =
      state.profileSource === "site"
        ? T("本站设置")
        : state.profileSource === "auto"
        ? T("自动回落")
        : state.profileSource === "global"
        ? T("跟随全局")
        : state.profileSource === "temporary"
        ? T("临时放行")
        : T("已关闭");
    $("#profileHint").textContent = sourceLabel;
    const auto = state.autoCompat;
    $("#autoCompatHint").hidden = !auto;
    if (auto) {
      $("#autoCompatText").textContent =
        T("检测到反广告拦截，已回落为兼容档") + (state.until ? T("（临时放行至 $1）", fmtTime(state.until)) : "");
    }
    const until = state.until || 0;
    const tempBtn = $("#btnTemp");
    if (until > Date.now()) {
      const mins = Math.max(1, Math.round((until - Date.now()) / 60000));
      tempBtn.textContent = T("已临时放行 · 剩余 $1 分钟 · 点击恢复", mins);
      tempBtn.classList.add("zz-btn-danger");
    } else {
      tempBtn.textContent = T("临时解除 $1 分钟", state.tempMinutes || 30);
      tempBtn.classList.remove("zz-btn-danger");
    }
    const types = state.types || {};
    for (const input of document.querySelectorAll(".zz-chip input[data-type]")) {
      input.checked = !!types[input.getAttribute("data-type")];
    }
    $("#siteHint").textContent = state.siteEnabled
      ? T("本站已启用") + (state.index && state.index.invalid ? T("（$1 条规则无效已跳过）", state.index.invalid) : "")
      : T("本站已停用，不会隐藏或拦截任何内容");
    const dnr = state.dnr || {};
    $("#engineInfo").textContent =
      T("网络规则 $1 条 · 外观规则 $2 条", dnr.applied || 0, (state.index && state.index.cosmetic) || 0);
    $("#pendingCount").textContent = state.findingsPending || 0;
    $("#btnAi").title = state.aiConfigured ? "" : T("请先在控制台配置 AI 接口");
  }

  let lastState = null;

  function fmtTime(ts) {
    try {
      const d = new Date(ts);
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    } catch (e) {
      return "";
    }
  }

  function escapeHtml(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  async function loadFindings() {
    const res = await UI.send({ type: "zz:findings:list", payload: { host, status: "pending" } });
    const list = (res && res.findings) || [];
    const section = $("#findingsSection");
    const box = $("#findings");
    if (!list.length) {
      section.hidden = true;
      box.innerHTML = "";
      return;
    }
    section.hidden = false;
    box.innerHTML = "";
    for (const f of list.slice(0, 12)) {
      const card = document.createElement("div");
      card.className = "zz-card";
      const conf = Math.round((f.confidence || 0) * 100);
      card.innerHTML = `
        <div class="zz-row">
          <span class="zz-tag zz-tag-${f.source === "ai" ? "ai" : "scan"}">${escapeHtml(UI.categoryLabel(f.category))} · ${conf}%</span>
          <button class="zz-btn zz-btn-sm zz-btn-ghost" data-id="${escapeHtml(f.id)}">${escapeHtml(T("屏蔽"))}</button>
        </div>
        <div class="zz-code">${escapeHtml(f.selector)}</div>
        ${f.reason ? `<div class="zz-small zz-muted" style="margin-top:4px">${escapeHtml(f.reason)}</div>` : ""}
      `;
      box.appendChild(card);
    }
    box.onclick = async (event) => {
      const btn = event.target.closest("button[data-id]");
      if (!btn) return;
      btn.disabled = true;
      const res2 = await UI.send({
        type: "zz:findings:apply",
        payload: { ids: [btn.getAttribute("data-id")], scope: "site" },
      });
      if (res2 && res2.ok) {
        UI.toast($("#msg"), T("已添加规则"), "ok");
        playSparkle(btn);
        fxClean(1);
        await refresh();
      }
    };
  }

  // ---------- 嗅探：网络请求 + 页面 DOM/脚本扫描 ----------
  async function scanMedia() {
    if (!tab || !/^https?:/i.test(tab.url || "")) return;
    const [sniff, dom] = await Promise.all([
      UI.send({ type: "zz:sniff:list", payload: { tabId: tab.id } }).catch(() => null),
      UI.sendToTab(tab.id, { type: "zz:toolbox:streams" }).catch(() => null),
    ]);
    const map = new Map();
    for (const s of (sniff && sniff.streams) || []) map.set(s.url, { url: s.url, kind: s.kind, note: T("网络请求") });
    for (const s of (dom && dom.streams) || []) if (!map.has(s.url)) map.set(s.url, s);
    const score = (s) => {
      let n = 0;
      if (/\.m3u8|\/hls\//i.test(s.url)) n += 5;
      if (/\.mpd/i.test(s.url)) n += 4;
      if (/\.mp4|\.webm/i.test(s.url)) n += 3;
      if (/master|index|playlist/i.test(s.url)) n += 1;
      return n;
    };
    mediaStreams = Array.from(map.values()).sort((a, b) => score(b) - score(a)).slice(0, 8);
    renderMedia();
  }

  function streamName(url) {
    try {
      const base = decodeURIComponent((url.split(/[?#]/)[0].split("/").pop() || "").slice(0, 60));
      return base || url.slice(0, 60);
    } catch (e) {
      return url.slice(0, 60);
    }
  }

  function renderMedia() {
    const section = $("#mediaSection");
    const box = $("#mediaList");
    const hint = $("#mediaHint");
    if (!mediaStreams.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    box.innerHTML = "";
    for (const s of mediaStreams) {
      const item = document.createElement("div");
      item.className = "zz-media-item";
      const kindLabel = s.kind === "m3u8" ? "HLS" : s.kind === "mpd" ? "DASH" : s.kind === "ts" ? "TS" : "VIDEO";
      item.innerHTML =
        '<span class="mi-kind">' + kindLabel + "</span>" +
        '<span class="mi-url" title="' + escapeHtml(s.url) + '">' + escapeHtml(streamName(s.url)) + "</span>" +
        '<button class="zz-btn zz-btn-sm zz-btn-primary" data-dl="' + escapeHtml(s.url) + '" data-kind="' + (s.kind || "media") + '">' + T("下载") + "</button>";
      box.appendChild(item);
    }
    hint.textContent = T("点「下载」直接创建任务（弹窗关闭进度也会保留）");
  }

  // 下载按钮魔法特效：迸发六颗光点
  function playSparkle(btn) {
    if (!btn || !btn.getBoundingClientRect) return;
    const r = btn.getBoundingClientRect();
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
    document.body.appendChild(holder);
    for (let i = 0; i < 6; i++) {
      const spark = document.createElement("span");
      const ang = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      const dist = 26 + Math.random() * 18;
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist - 8;
      spark.style.cssText =
        "position:absolute;left:" + (r.left + r.width / 2) + "px;top:" + (r.top + r.height / 2) + "px;" +
        "width:6px;height:6px;border-radius:50%;background:radial-gradient(circle,#93c5fd,#3b82f6);" +
        "box-shadow:0 0 8px rgba(59,130,246,.9);" +
        "transition:transform .55s cubic-bezier(.22,1.4,.36,1),opacity .55s ease;";
      holder.appendChild(spark);
      requestAnimationFrame(() => {
        spark.style.transform = "translate(" + dx + "px," + dy + "px) scale(0.2)";
        spark.style.opacity = "0";
      });
    }
    setTimeout(() => holder.remove(), 700);
  }

  async function fxClean(count) {
    if (!tab) return;
    try {
      await api.tabs.sendMessage(tab.id, { type: "zz:fx:clean", payload: { count: count || 0 } });
    } catch (e) {}
  }

  const busyStreams = new Set();
  $("#mediaList").addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-dl]");
    if (!btn || busyStreams.has(btn.getAttribute("data-dl"))) return;
    const url = btn.getAttribute("data-dl");
    const kind = btn.getAttribute("data-kind") || "media";
    const dir = kind === "m3u8" || kind === "mpd" || kind === "ts" ? "ZeroZen/视频" : "ZeroZen/下载";
    let name = ZZDLEngine.sanitize(streamName(url));
    busyStreams.add(url);
    btn.disabled = true;
    btn.textContent = T("创建中…");
    try {
      let saved = "";
      if (/\.m3u8|\/hls\//i.test(url)) {
        const res = await ZZDLEngine.downloadM3u8(url, {
          concurrency: 6,
          nameBase: name.replace(/\.(m3u8|mp4|ts)$/i, "") || "video",
          dir,
          onProgress: () => {},
        });
        if (res.cancelled) throw new Error(T("已取消"));
        saved = res.saved;
      } else if (/\.mpd/i.test(url)) {
        await ZZDLEngine.download(url, dir + "/" + name);
        saved = dir + "/" + name;
      } else {
        // 直链：优先多线程，失败回浏览器默认下载
        try {
          const res = await ZZDLEngine.multiThreadDownload(url, name, dir, 4, () => {}, null);
          saved = res.cancelled ? "" : res.saved;
        } catch (e) {
          await ZZDLEngine.download(url, dir + "/" + name);
          saved = dir + "/" + name;
        }
      }
      playSparkle(btn);
      UI.toast($("#msg"), T("任务已创建：$1", saved || name), "ok");
      await refreshTasks(true);
    } catch (e) {
      UI.toast($("#msg"), T("创建失败：$1", (e && e.message) || e), "err");
      btn.disabled = false;
      btn.textContent = T("下载");
    } finally {
      busyStreams.delete(url);
      if (btn.isConnected && btn.textContent !== T("下载")) {
        btn.disabled = false;
        btn.textContent = T("下载");
      }
    }
  });
  $("#btnRescan").addEventListener("click", scanMedia);

  // ---------- 任务中心：浏览器下载记录 + 本地未完成任务，按类型分组 ----------
  function classifyFile(nameOrUrl) {
    const ext = (String(nameOrUrl).split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
    if (/^(mp4|ts|webm|mkv|avi|mov|flv|m4v|m3u8|mpd)$/.test(ext)) return "video";
    if (/^(mp3|m4a|flac|wav|aac|ogg|opus)$/.test(ext)) return "audio";
    if (/^(jpg|jpeg|png|gif|webp|avif|bmp|svg|ico)$/.test(ext)) return "image";
    if (/^(zip|rar|7z|tar|gz|bz2|xz|apk|dmg|iso)$/.test(ext)) return "archive";
    if (/^(pdf|doc|docx|xls|xlsx|ppt|pptx|epub|mobi|txt|md|csv)$/.test(ext)) return "doc";
    return "other";
  }

  function taskNameOf(path) {
    return String(path || "").split(/[\\/]/).pop() || "—";
  }

  async function refreshTasks(interactive) {
    const section = $("#taskSection");
    let items = [];
    // downloads 是可选权限：只允许用户手势触发申请；定时刷新静默跳过，已授权才读取记录
    let granted = false;
    try {
      if (interactive) granted = await UI.ensurePermission("downloads");
      else granted = !!(api.downloads && api.downloads.search);
    } catch (e) {}
    if (granted && api.downloads && api.downloads.search) {
      const records = await new Promise((resolve) =>
        api.downloads.search({ orderBy: ["-startTime"], limit: 60 }, (r) => resolve(r || []))
      );
      for (const it of records) {
        const name = taskNameOf(it.filename || it.url);
        items.push({
          key: "d" + it.id,
          id: it.id,
          name,
          cat: classifyFile(name),
          state: it.state === "complete" ? "done" : it.state === "interrupted" ? "err" : it.paused ? "paused" : "run",
          pct: it.totalBytes > 0 ? Math.min(100, Math.round(((it.bytesReceived || 0) / it.totalBytes) * 100)) : it.state === "complete" ? 100 : 0,
          size: it.totalBytes || it.bytesReceived || 0,
          resume: null,
        });
      }
    }
    try {
      const local = (globalThis.ZZDLStore ? await ZZDLStore.listTasks() : []) || [];
      for (const t of local) {
        const name = t.kind === "m3u8" ? t.nameBase : t.name;
        items.unshift({
          key: "l" + t.id,
          id: t.id,
          name,
          cat: classifyFile(name),
          state: t.status === "error" ? "err" : "paused",
          pct: t.total ? Math.min(100, Math.round(((t.done || 0) / t.total) * 100)) : 0,
          size: t.total || 0,
          resume: t,
        });
      }
    } catch (e) {}
    items = items.filter((it) => taskFilter === "all" || it.cat === taskFilter).slice(0, 14);
    // 渲染签名：内容没变就不重建 DOM，避免定时刷新导致滚动位置跳动
    const sig = items.map((it) => it.key + ":" + it.state + ":" + it.pct).join("|");
    if (sig === taskRenderSig) {
      section.hidden = !items.length;
      return;
    }
    taskRenderSig = sig;
    section.hidden = !items.length;
    const box = $("#taskList");
    box.innerHTML = "";
    const stateLabel = { done: T("已完成"), err: T("失败"), paused: T("已暂停"), run: T("下载中") };
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "zz-task-item" + (it.state === "run" ? " run" : "");
      row.innerHTML =
        '<span class="ti-name" title="' + escapeHtml(it.name) + '">' + escapeHtml(it.name) + "</span>" +
        '<span class="ti-meta">' + (it.size ? ZZDLEngine.bytes(it.size) + " · " : "") + stateLabel[it.state] + "</span>" +
        (it.resume ? '<button class="zz-btn zz-btn-sm" data-tresume="' + escapeHtml(it.id) + '">' + T("继续") + "</button>" : "") +
        (it.resume ? '<button class="zz-btn zz-btn-sm zz-btn-danger" data-tdrop="' + escapeHtml(it.id) + '">' + T("删除") + "</button>" : "") +
        '<i class="ti-bar" style="width:' + it.pct + '%"></i>';
      box.appendChild(row);
    }
    if (!box.childElementCount && taskFilter !== "all") section.hidden = true;
  }

  const busyTasks = new Set();
  let taskRenderSig = "";
  $("#taskList").addEventListener("click", async (event) => {
    const resumeBtn = event.target.closest("button[data-tresume]");
    const dropBtn = event.target.closest("button[data-tdrop]");
    if (dropBtn) {
      await ZZDLStore.removeTask(dropBtn.getAttribute("data-tdrop"));
      await refreshTasks();
      return;
    }
    if (!resumeBtn || busyTasks.has(resumeBtn.getAttribute("data-tresume"))) return;
    const id = resumeBtn.getAttribute("data-tresume");
    const task = (globalThis.ZZDLStore ? await ZZDLStore.getTask(id) : null);
    if (!task) return;
    busyTasks.add(id);
    resumeBtn.disabled = true;
    try {
      if (task.kind === "m3u8") {
        const res = await ZZDLEngine.downloadM3u8(task.url, {
          concurrency: Math.max(1, Math.min(12, task.concurrency || 6)),
          nameBase: task.nameBase,
          dir: task.dir,
          tsAsMp4: !!task.tsAsMp4,
          onProgress: () => {},
        });
        UI.toast($("#msg"), res.cancelled ? T("已暂停，进度已保留") : T("任务完成：$1", res.saved), res.cancelled ? "" : "ok");
      } else {
        const res = await ZZDLEngine.multiThreadDownload(task.url, task.name, task.dir, task.threads || 4, () => {}, null);
        UI.toast($("#msg"), res.cancelled ? T("已暂停，进度已保留") : T("任务完成：$1", res.saved), res.cancelled ? "" : "ok");
      }
      playSparkle(resumeBtn);
    } catch (e) {
      UI.toast($("#msg"), T("失败：$1", (e && e.message) || e), "err");
    } finally {
      busyTasks.delete(id);
      await refreshTasks(true);
    }
  });
  $("#taskFilters").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-cat]");
    if (!btn) return;
    taskFilter = btn.getAttribute("data-cat");
    for (const b of document.querySelectorAll("#taskFilters button")) b.classList.toggle("active", b === btn);
    refreshTasks(false);
  });
  $("#btnTaskRefresh").addEventListener("click", () => refreshTasks(true));

  async function refresh(interactive) {
    if (!tab) return;
    const res = await UI.send({ type: "zz:state:get", payload: { tabId: tab.id } });
    if (res && res.ok) {
      if (res.host && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(res.host)) host = res.host;
      $("#host").textContent = host || tab.title || T("当前页面");
      renderState(res);
    }
    // 嗅探只在打开弹窗或手动触发时全量扫描，定时刷新不做（页面源码正则扫描开销大）
    if (interactive || !mediaStreams.length) await scanMedia();
    await refreshTasks(!!interactive);
  }

  async function init() {
    await UI.initLocale();
    tab = await UI.currentTab();
    if (!tab) return;
    try {
      host = new URL(tab.url).hostname.toLowerCase();
    } catch (e) {
      host = "";
    }
    if (!/^https?:/i.test(tab.url || "")) {
      $("#host").textContent = T("此页面不支持");
      $("#siteHint").textContent = T("ZeroZen 仅作用于 http/https 页面");
      $("#btnAi").disabled = true;
      $("#btnPick").disabled = true;
      $("#siteEnabled").disabled = true;
      return;
    }
    $("#host").textContent = host || tab.title || T("当前页面");
    await refresh(true);
    await loadFindings();
    refreshTimer = setInterval(() => refresh(), 3000);
  }

  $("#globalEnabled").addEventListener("change", async (event) => {
    const res = await UI.send({ type: "zz:settings:set", payload: { settings: { enabled: event.target.checked } } });
    if (!res || !res.ok) {
      UI.toast($("#msg"), T("操作失败：$1", (res && res.error) || T("后台无响应")), "err");
      setTimeout(refresh, 200);
      return;
    }
    UI.toast($("#msg"), T(event.target.checked ? "ZeroZen 已启用" : "ZeroZen 已全局停用"), event.target.checked ? "ok" : "");
    setTimeout(refresh, 300);
  });

  $("#siteEnabled").addEventListener("change", async (event) => {
    const enabled = event.target.checked;
    const res = await UI.send({ type: "zz:site:set", payload: { host, enabled, tabId: tab && tab.id } });
    if (!res || !res.ok) {
      UI.toast($("#msg"), T("操作失败：$1", (res && res.error) || T("后台无响应")), "err");
      setTimeout(refresh, 200);
      return;
    }
    UI.toast($("#msg"), T(enabled ? "已在此站点启用" : "已在此站点停用"), enabled ? "ok" : "");
    setTimeout(refresh, 300);
  });

  $("#profileSeg").addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-profile]");
    if (!btn || btn.disabled) return;
    for (const b of document.querySelectorAll("#profileSeg .zz-seg-btn")) {
      b.classList.toggle("active", b === btn);
    }
    const res = await UI.send({
      type: "zz:site:set",
      payload: { host, profile: btn.getAttribute("data-profile"), clearAuto: true, tabId: tab && tab.id },
    });
    if (!res || !res.ok) {
      UI.toast($("#msg"), T("切换失败：$1", (res && res.error) || T("后台无响应")), "err");
      setTimeout(refresh, 200);
      return;
    }
    UI.toast($("#msg"), T("已切换为「$1」档", btn.textContent.trim()), "ok");
    setTimeout(refresh, 300);
  });

  $("#btnTemp").addEventListener("click", async () => {
    const until = (lastState && lastState.until) || 0;
    if (until > Date.now()) {
      await UI.send({ type: "zz:site:temp", payload: { host, minutes: 0, tabId: tab && tab.id } });
      UI.toast($("#msg"), T("已恢复拦截"), "ok");
    } else {
      const minutes = (lastState && lastState.tempMinutes) || 30;
      await UI.send({ type: "zz:site:temp", payload: { host, minutes, tabId: tab && tab.id } });
      UI.toast($("#msg"), T("已临时放行本站 $1 分钟", minutes), "ok");
    }
    setTimeout(refresh, 300);
  });

  $("#btnResetAuto").addEventListener("click", async () => {
    await UI.send({ type: "zz:site:set", payload: { host, profile: "default", clearAuto: true, tabId: tab && tab.id } });
    UI.toast($("#msg"), T("已恢复本站默认设置"), "ok");
    setTimeout(refresh, 300);
  });

  $("#btnClean").addEventListener("click", async () => {
    const res = await UI.send({ type: "zz:clean:set", payload: { tabId: tab && tab.id } });
    if (res && res.ok) {
      UI.toast($("#msg"), T(res.active ? "已进入纯净浏览（再点一次恢复）" : "已退出纯净浏览"), "ok");
      if (res.active) fxClean(0);
    } else UI.toast($("#msg"), T("操作失败：$1", (res && res.error) || T("内容脚本无响应")), "err");
  });

  $("#btnReader").addEventListener("click", async () => {
    const res = await UI.send({ type: "zz:reader:toggle", payload: { tabId: tab && tab.id } });
    if (res && res.ok) UI.toast($("#msg"), T(res.active ? "已进入阅读模式（可保存 Markdown）" : "已退出阅读模式"), "ok");
    else UI.toast($("#msg"), T("阅读模式失败：$1", (res && res.error) || T("无法提取正文")), "err");
  });

  document.querySelector(".zz-chips").addEventListener("change", async (event) => {
    const input = event.target.closest("input[data-type]");
    if (!input) return;
    const type = input.getAttribute("data-type");
    if (type === "annoyances") {
      await UI.send({ type: "zz:packs:set", payload: { id: "annoyances", enabled: input.checked } });
    } else {
      const key = type === "popup" ? "popupGuard" : type;
      const settings = {};
      settings[key] = input.checked;
      await UI.send({ type: "zz:settings:set", payload: { settings } });
    }
    UI.toast($("#msg"), T("已更新屏蔽类型"), "ok");
    setTimeout(refresh, 300);
  });

  $("#btnAi").addEventListener("click", async (event) => {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = T("正在识别…（会调用一次 AI）");
    const res = await UI.send({ type: "zz:ai:recognize-tab", payload: { tabId: tab && tab.id } });
    btn.disabled = false;
    btn.textContent = T("AI 识别本页烦人广告");
    if (!res || !res.ok) {
      UI.toast($("#msg"), T("识别失败：$1", (res && res.error) || T("未知错误")), "err");
      return;
    }
    const found = (res.findings || []).length;
    UI.toast(
      $("#msg"),
      found
        ? T("识别到 $1 处，已在页面标记", found) + (res.applied ? T("，自动屏蔽 $1 处", res.applied) : "")
        : T("未发现新的广告元素"),
      "ok"
    );
    if (res.applied) fxClean(res.applied);
    await refresh();
    await loadFindings();
  });

  $("#btnPick").addEventListener("click", async () => {
    await UI.send({ type: "zz:picker:start", payload: { tabId: tab && tab.id } });
    window.close();
  });

  $("#btnOptions").addEventListener("click", async () => {
    const ok = await UI.openOptions();
    if (!ok) {
      UI.toast($("#msg"), T("打不开控制台，请重载扩展后再试"), "err");
      return;
    }
    window.close();
  });

  $("#btnApplyAll").addEventListener("click", async () => {
    const res = await UI.send({ type: "zz:findings:list", payload: { host, status: "pending" } });
    const ids = ((res && res.findings) || []).map((f) => f.id);
    if (!ids.length) return;
    const applied = await UI.send({ type: "zz:findings:apply", payload: { ids, scope: "site" } });
    UI.toast(
      $("#msg"),
      applied && applied.ok ? T("已屏蔽 $1 条", applied.rules) : T("操作失败"),
      applied && applied.ok ? "ok" : "err"
    );
    if (applied && applied.ok) fxClean(applied.rules);
    await refresh();
    await loadFindings();
  });

  $("#linkReview").addEventListener("click", (event) => {
    event.preventDefault();
    api.tabs.create({ url: api.runtime.getURL("ui/options.html#findings") });
  });

  window.addEventListener("unload", () => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  init();
})();

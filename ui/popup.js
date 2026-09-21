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
  let currentTaskItems = [];

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
    const wl = $("#btnWhitelist");
    if (wl) {
      wl.textContent = state.siteEnabled ? T("加入白名单") : T("移出白名单");
      wl.classList.toggle("zz-btn-danger", !state.siteEnabled);
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
    busyStreams.add(url);
    btn.disabled = true;
    btn.textContent = T("创建中…");
    try {
      // 入队 + 派发到工具箱页后台执行（popup 生命周期短，长下载不在弹窗里跑）
      const Store = globalThis.ZZDLStore;
      let queued = false;
      if (Store && (/\.m3u8|\/hls\//i.test(url) || /\.(mp4|webm|mkv|avi|mov|flv|m4v|mp3|m4a|zip|rar|7z|apk|pdf|iso|ts)(\?|#|$)/i.test(url))) {
        const isHls = /\.m3u8|\/hls\//i.test(url);
        const rawName = streamName(url);
        const record = {
          id: Store.taskId("queue", url, rawName),
          queued: true,
          status: "queued",
          kind: isHls ? "m3u8" : "multi",
          url,
          name: isHls ? undefined : ZZDLEngine.sanitize(rawName),
          nameBase: isHls ? ZZDLEngine.sanitize(rawName.replace(/\.(m3u8|mp4|ts)$/i, "")) : undefined,
          dir: ZZDLEngine.dirForType(isHls ? "video" : ZZDLEngine.classifyExt(url)),
          concurrency: 6,
          threads: 4,
          tsAsMp4: false,
          createdAt: Date.now(),
        };
        await Store.putTask(record);
        const res = await UI.send({ type: "zz:dl:dispatch", payload: { taskId: record.id } });
        queued = !!(res && res.ok);
      }
      if (!queued) {
        // 无法入队（无存储或类型不适用）：直接走浏览器默认下载
        const dir = ZZDLEngine.dirForType(ZZDLEngine.classifyExt(url));
        await ZZDLEngine.download(url, dir + "/" + ZZDLEngine.sanitize(streamName(url)));
      }
      playSparkle(btn);
      UI.toast($("#msg"), queued ? T("任务已创建，正在后台下载") : T("已加入下载"), "ok");
      await refreshTasks(true);
    } catch (e) {
      UI.toast($("#msg"), T("创建失败：$1", (e && e.message) || e), "err");
    } finally {
      busyStreams.delete(url);
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = T("下载");
      }
    }
  });
  $("#btnRescan").addEventListener("click", scanMedia);

  // ---------- 任务中心：浏览器下载记录 + 本地未完成任务 ----------
  // 分类/目录/错误分析逻辑在 dl-engine，popup 与工具箱共用
  const taskState = { filter: "all", stateFilter: "all", sort: "time" };
  const taskSpeeds = new Map(); // key -> { bytes, at, speed }
  const CAT_LABEL = {
    video: T("视频"),
    audio: T("音频"),
    image: T("图片"),
    archive: T("压缩包"),
    doc: T("文档"),
    other: T("其他"),
  };

  function taskNameOf(path) {
    return String(path || "").split(/[\\/]/).pop() || "—";
  }

  function sortByMode(items, mode) {
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), "zh-Hans-CN", { numeric: true });
    const arr = items.slice();
    if (mode === "size") arr.sort((a, b) => (b.totalBytes || 0) - (a.totalBytes || 0) || byName(a, b));
    else if (mode === "name") arr.sort(byName);
    else if (mode === "speed") arr.sort((a, b) => (b.speed || 0) - (a.speed || 0) || (b.at || 0) - (a.at || 0));
    else if (mode === "state") {
      const order = { run: 0, paused: 1, err: 2, done: 3 };
      arr.sort((a, b) => order[a.state] - order[b.state] || byName(a, b));
    } else arr.sort((a, b) => (b.at || 0) - (a.at || 0)); // time
    return arr;
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
      const now = Date.now();
      for (const it of records) {
        const name = taskNameOf(it.filename || it.url);
        // 速度采样：两次刷新的字节差 / 时间差
        const prev = taskSpeeds.get("d" + it.id);
        let speed = prev ? prev.speed : 0;
        if (prev && now > prev.at && it.state === "in_progress") {
          const inst = ((it.bytesReceived || 0) - prev.bytes) / ((now - prev.at) / 1000);
          if (inst > 0) speed = inst;
        }
        taskSpeeds.set("d" + it.id, { bytes: it.bytesReceived || 0, at: now, speed });
        const hint = it.state === "interrupted" && it.error !== "USER_CANCELED" ? ZZDLEngine.errorHint({ error: it.error }) : null;
        items.push({
          key: "d" + it.id,
          id: it.id,
          src: "chrome",
          name,
          cat: ZZDLEngine.classifyExt(name),
          url: it.url || "",
          path: it.filename || "",
          state: it.state === "complete" ? "done" : it.state === "interrupted" ? "err" : it.paused ? "paused" : "run",
          pct: it.totalBytes > 0 ? Math.min(100, Math.round(((it.bytesReceived || 0) / it.totalBytes) * 100)) : it.state === "complete" ? 100 : 0,
          totalBytes: it.totalBytes || 0,
          hint,
          at: it.startTime ? new Date(it.startTime).getTime() : 0,
          speed,
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
          src: "local",
          name,
          cat: ZZDLEngine.classifyExt(name),
          url: t.url || "",
          path: (t.dir || "") + "/" + name,
          state: t.status === "error" ? "err" : t.status === "queued" ? "queued" : "paused",
          pct: t.total ? Math.min(100, Math.round(((t.done || 0) / t.total) * 100)) : 0,
          totalBytes: t.total || 0,
          hint: t.status === "error" ? ZZDLEngine.errorHint({ message: t.error }) : null,
          at: t.createdAt || 0,
          speed: 0,
          resume: t,
        });
      }
    } catch (e) {}
    items = items.filter(
      (it) =>
        (taskState.filter === "all" || it.cat === taskState.filter) &&
        (taskState.stateFilter === "all" || it.state === taskState.stateFilter || (taskState.stateFilter === "paused" && it.state === "queued"))
    );
    items = sortByMode(items, taskState.sort).slice(0, 16);
    currentTaskItems = items;
    // 渲染签名：内容没变就不重建 DOM，避免定时刷新导致滚动位置跳动
    const sig = items.map((it) => it.key + ":" + it.state + ":" + it.pct + ":" + Math.round(it.speed || 0)).join("|");
    if (sig === taskRenderSig) {
      section.hidden = !items.length;
      return;
    }
    taskRenderSig = sig;
    section.hidden = !items.length;
    const box = $("#taskList");
    box.innerHTML = "";
    const stateLabel = { done: T("已完成"), err: T("失败"), paused: T("已暂停"), run: T("下载中"), queued: T("排队中") };
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "zz-task-item" + (it.state === "run" ? " run" : "") + (it.state === "err" ? " err" : "");
      const metaParts = [CAT_LABEL[it.cat] || ""];
      if (it.totalBytes) metaParts.push(ZZDLEngine.bytes(it.totalBytes) + (it.pct ? " · " + it.pct + "%" : ""));
      if (it.state === "run" && it.speed) metaParts.push(ZZDLEngine.bytes(it.speed) + "/s");
      metaParts.push(stateLabel[it.state]);
      if (it.hint) metaParts.push(it.hint.reason);
      const btns = [];
      const b = (attr, key, cls) => '<button class="zz-btn zz-btn-sm ' + (cls || "") + '" ' + attr + ">" + T(key) + "</button>";
      if (it.state === "done" && it.src === "chrome") {
        btns.push(b('data-tact="open" data-key="' + it.key + '"', "打开"));
        btns.push(b('data-tact="show" data-key="' + it.key + '"', "Finder"));
      }
      if (it.state === "run" && it.src === "chrome") btns.push(b('data-tact="pause" data-key="' + it.key + '"', "暂停"));
      if (it.state === "paused" && it.src === "chrome") btns.push(b('data-tact="resume" data-key="' + it.key + '"', "继续"));
      if (it.state === "err") btns.push(b('data-tact="report" data-key="' + it.key + '"', "反馈", "zz-btn-danger"));
      if (it.src === "local") {
        btns.push(b('data-tact="localresume" data-key="' + escapeHtml(it.id) + '"', "继续", "zz-btn-primary"));
        btns.push(b('data-tact="drop" data-key="' + escapeHtml(it.id) + '"', "删除", "zz-btn-danger"));
      } else if (it.state === "err" && it.url) {
        btns.push(b('data-tact="retry" data-key="' + it.key + '"', "重试"));
      }
      if (it.url) btns.push(b('data-tact="copyurl" data-key="' + it.key + '" data-url="' + escapeHtml(it.url) + '"', "链接"));
      if (it.path) btns.push(b('data-tact="copypath" data-key="' + it.key + '" data-path="' + escapeHtml(it.path) + '"', "路径"));
      row.innerHTML =
        '<span class="ti-name" title="' + escapeHtml(it.name + (it.path ? "\n" + it.path : "")) + '">' + escapeHtml(it.name) + "</span>" +
        '<span class="ti-meta">' + metaParts.filter(Boolean).join(" · ") + "</span>" +
        btns.join("") +
        '<i class="ti-bar" style="width:' + (it.state === "err" ? 100 : it.pct) + "%;opacity:" + (it.state === "err" ? 0.5 : 1) + '"></i>';
      box.appendChild(row);
    }
    if (!box.childElementCount && taskState.filter !== "all") section.hidden = true;
  }

  async function reportTask(item) {
    const report = ZZDLEngine.buildReport(item);
    try {
      await navigator.clipboard.writeText(report);
    } catch (e) {}
    api.tabs.create({ url: ZZDLEngine.issueUrl(report) });
    UI.toast($("#msg"), T("诊断报告已复制，已打开 GitHub 反馈页，粘贴到正文即可"), "ok");
  }

  const busyTasks = new Set();
  let taskRenderSig = "";
  $("#taskList").addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-tact]");
    if (!btn) return;
    const act = btn.getAttribute("data-tact");
    const key = btn.getAttribute("data-key") || "";
    const byKey = () => currentTaskItems.find((x) => x.key === key);
    const call = (fn) => {
      try {
        const ret = fn();
        if (ret && typeof ret.catch === "function") ret.catch(() => {});
      } catch (e) {}
    };
    try {
      if (act === "drop") {
        await ZZDLStore.removeTask(key);
        await refreshTasks(false);
        return;
      }
      if (act === "copyurl") {
        await navigator.clipboard.writeText(btn.getAttribute("data-url") || "");
        UI.toast($("#msg"), T("链接已复制"), "ok");
        return;
      }
      if (act === "copypath") {
        await navigator.clipboard.writeText(btn.getAttribute("data-path") || "");
        UI.toast($("#msg"), T("路径已复制，可在 Finder「前往文件夹」粘贴"), "ok");
        return;
      }
      if (act === "report") {
        const item = byKey();
        if (item) await reportTask(item);
        return;
      }
      const item = byKey();
      if (!item) return;
      if (act === "open") call(() => api.downloads.open(item.id));
      else if (act === "show") call(() => api.downloads.show(item.id));
      else if (act === "pause") call(() => api.downloads.pause(item.id));
      else if (act === "resume") call(() => api.downloads.resume(item.id));
      else if (act === "retry" && item.url) {
        call(() => api.downloads.erase({ id: item.id }));
        await new Promise((r) => setTimeout(r, 250));
        const dir = ZZDLEngine.dirForType(item.cat);
        await ZZDLEngine.download(item.url, dir + "/" + item.name);
        UI.toast($("#msg"), T("已重新下载到 $1", dir), "ok");
        playSparkle(btn);
      } else if (act === "localresume") {
        // 统一派发到工具箱页后台执行（popup 关闭也不中断）
        const res = await UI.send({ type: "zz:dl:dispatch", payload: { taskId: key } });
        if (res && res.ok) {
          playSparkle(btn);
          UI.toast($("#msg"), T("已交给下载器后台执行"), "ok");
        } else {
          UI.toast($("#msg"), T("派发失败：$1", (res && res.error) || T("未知错误")), "err");
        }
      }
    } catch (e) {
      UI.toast($("#msg"), T("操作失败：$1", (e && e.message) || e), "err");
    } finally {
      setTimeout(() => refreshTasks(false), 400);
    }
  });
  $("#taskFilters").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-cat]");
    if (!btn) return;
    taskState.filter = btn.getAttribute("data-cat");
    for (const b of document.querySelectorAll("#taskFilters button")) b.classList.toggle("active", b === btn);
    taskRenderSig = "";
    refreshTasks(false);
  });
  $("#taskStateFilters").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-state]");
    if (!btn) return;
    taskState.stateFilter = btn.getAttribute("data-state");
    for (const b of document.querySelectorAll("#taskStateFilters button")) b.classList.toggle("active", b === btn);
    taskRenderSig = "";
    refreshTasks(false);
  });
  $("#taskSort").addEventListener("change", (event) => {
    taskState.sort = event.target.value;
    taskRenderSig = "";
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

  $("#btnWhitelist").addEventListener("click", async () => {
    const enable = !(lastState && lastState.siteEnabled);
    const res = await UI.send({ type: "zz:site:set", payload: { host, enabled: enable, tabId: tab && tab.id } });
    if (res && res.ok) {
      playSparkle($("#btnWhitelist"));
      UI.toast($("#msg"), T(enable ? "已移出白名单，恢复正常拦截" : "已加入白名单，本站不再拦截"), "ok");
    } else {
      UI.toast($("#msg"), T("操作失败：$1", (res && res.error) || T("后台无响应")), "err");
    }
    setTimeout(refresh, 300);
  });

  $("#btnReload").addEventListener("click", async () => {
    if (!tab || typeof tab.id !== "number") return;
    try {
      await api.tabs.reload(tab.id);
      UI.toast($("#msg"), T("页面已刷新"), "ok");
      setTimeout(() => window.close(), 400);
    } catch (e) {
      UI.toast($("#msg"), T("操作失败：$1", (e && e.message) || e), "err");
    }
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

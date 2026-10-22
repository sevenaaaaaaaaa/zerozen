// 下载界面组件（popup / 下载中心 / 工具箱共用）：
//   ZZDLUI.mediaList(box, opts)  本页可下载媒体：自动识别画质/时长/加密，主列表与子画质合并成一条
//   ZZDLUI.taskList(box, opts)   任务卡片：进度、速度、剩余时间、状态与操作（暂停/继续/重试/打开文件夹/删除）
// 进度实时：下载宿主经 BroadcastChannel("zz-dl") 推送，任何页面打开即同步，无需轮询宿主。
(function () {
  const g = globalThis;
  const UI = g.ZZUI;
  const T = UI.T;
  const E = g.ZZDLEngine;
  const api = g.ZZ.browser;

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function short(url) {
    try {
      const u = new URL(url);
      const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
      return u.hostname + (last ? " · " + last.slice(0, 40) : "");
    } catch (e) {
      return String(url).slice(0, 60);
    }
  }

  // ---------------- 设置 ----------------

  async function settings() {
    const res = await UI.send({ type: "zz:settings:get" });
    return (res && res.settings && res.settings.toolbox) || {};
  }

  // ---------------- 本页媒体 ----------------

  const probeCache = new Map();

  function probe(url, referrer) {
    if (!probeCache.has(url)) {
      probeCache.set(
        url,
        UI.send({ type: "zz:dl:probe", payload: { url, referrer } }).then((r) => (r && r.ok ? r.info : { error: (r && r.error) || "" }))
      );
    }
    return probeCache.get(url);
  }

  /**
   * opts: { tabId, compact, onAdded(task) , hint(el) }
   * 返回 { refresh() }
   */
  function mediaList(box, opts) {
    const o = opts || {};
    let ctx = { title: "", pageUrl: "", streams: [], webRequest: true };
    let toolbox = {};

    async function load() {
      const [res, dom, tb] = await Promise.all([
        UI.send({ type: "zz:sniff:list", payload: { tabId: o.tabId } }),
        o.tabId && UI.sendToTab ? UI.sendToTab(o.tabId, { type: "zz:toolbox:streams" }).catch(() => null) : null,
        settings(),
      ]);
      toolbox = tb || {};
      ctx = {
        title: (res && res.title) || "",
        pageUrl: (res && res.pageUrl) || "",
        webRequest: !res || res.webRequest !== false,
        streams: ((res && res.streams) || []).slice(),
      };
      // 页面源码扫描（播放器配置里写死的地址）作为补充来源
      for (const s of (dom && dom.streams) || []) {
        if (!ctx.streams.some((x) => x.url === s.url) && /^https?:/i.test(s.url) && /m3u8|\.mp4|\.webm|\.mpd/i.test(s.url)) {
          ctx.streams.push({ url: s.url, kind: /m3u8/i.test(s.url) ? "m3u8" : /\.mpd/i.test(s.url) ? "mpd" : "media", source: "dom" });
        }
      }
      await render();
    }

    async function render() {
      const streams = ctx.streams.filter((s) => s.kind === "m3u8" || s.kind === "media" || s.kind === "audio" || s.kind === "mpd");
      if (!streams.length) {
        box.innerHTML =
          '<div class="dl-empty">' +
          esc(T("还没发现可下载的视频。先在页面里点播放，再回来看看。")) +
          (ctx.webRequest ? "" : '<br><a href="#" data-act="grant-wr">' + esc(T("开启网络嗅探（可抓到更多视频）")) + "</a>") +
          "</div>";
        bindGrant();
        if (o.onCount) o.onCount(0);
        return;
      }
      // 先探测所有 m3u8：主列表展开画质，被主列表包含的子列表隐藏
      const hls = streams.filter((s) => s.kind === "m3u8");
      const infos = await Promise.all(hls.map((s) => probe(s.url, s.referer || ctx.pageUrl)));
      const childUrls = new Set();
      hls.forEach((s, i) => {
        const info = infos[i];
        s.info = info;
        if (info && info.master) for (const v of info.variants || []) childUrls.add(v.url);
      });
      const items = streams.filter((s) => !(s.kind === "m3u8" && childUrls.has(s.url)) && !(s.info && s.info.error && /有效的 m3u8|EXTM3U/.test(s.info.error)));
      if (o.onCount) o.onCount(items.length);
      const name = E.titleToName(ctx.title, ctx.pageUrl);
      box.innerHTML = items
        .slice(0, o.compact ? 6 : 30)
        .map((s, idx) => {
          const info = s.info || {};
          const tags = [];
          let quality = "";
          if (s.kind === "m3u8") {
            tags.push(info.live ? T("直播") : "HLS");
            if (info.master && info.variants && info.variants.length) {
              quality =
                '<select class="zz-select dl-q" data-idx="' + idx + '">' +
                info.variants.map((v, i) => '<option value="' + i + '">' + esc(v.label || E.qualityLabel(v)) + (v.audioUrl ? " +" + esc(T("音轨")) : "") + "</option>").join("") +
                "</select>";
            }
            if (info.duration) tags.push(E.duration(info.duration));
            if (info.aes) tags.push(T("加密"));
            if (info.drm) tags.push("DRM");
          } else if (s.kind === "mpd") tags.push("DASH");
          else tags.push(s.kind === "audio" ? T("音频") : T("视频文件"));
          if (s.size) tags.push(E.bytes(s.size));
          const drm = info.drm || s.kind === "mpd";
          const err = info.error ? T("暂时无法读取（$1）", info.error) : "";
          return (
            '<div class="dl-media" data-idx="' + idx + '">' +
            '<div class="dl-media-main"><div class="dl-media-title" title="' + esc(s.url) + '">' + esc(items.length > 1 ? name + " · " + (idx + 1) : name) + "</div>" +
            '<div class="dl-media-meta">' + tags.map((t) => "<span>" + esc(t) + "</span>").join("") + '<span class="dl-src">' + esc(short(s.url)) + "</span></div>" +
            (err ? '<div class="dl-media-err">' + esc(err) + "</div>" : "") +
            (drm ? '<div class="dl-media-err">' + esc(s.kind === "mpd" ? T("DASH 分轨流暂不支持下载") : T("受 DRM 保护，无法下载")) + "</div>" : "") +
            "</div>" +
            '<div class="dl-media-act">' + quality +
            '<button class="zz-btn zz-btn-sm zz-btn-primary" data-act="dl" data-idx="' + idx + '"' + (drm ? " disabled" : "") + ">" + esc(info.live ? T("录制") : T("下载")) + "</button></div>" +
            "</div>"
          );
        })
        .join("");
      box._items = items;
    }

    function bindGrant() {
      const a = box.querySelector("[data-act=grant-wr]");
      if (!a) return;
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        if (await UI.ensurePermission("webRequest")) {
          UI.toast && o.toastEl && UI.toast(o.toastEl, T("已开启，刷新页面并播放后即可嗅探"), "ok");
        }
      });
    }

    box.addEventListener("click", async (event) => {
      const btn = event.target.closest("button[data-act=dl]");
      if (!btn) return;
      const s = (box._items || [])[Number(btn.getAttribute("data-idx"))];
      if (!s) return;
      // 下载权限只能在用户点击里申请
      if (!(await UI.ensurePermission("downloads"))) {
        if (o.toastEl) UI.toast(o.toastEl, T("需要「下载」权限才能保存文件"), "err");
        return;
      }
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = T("添加中…");
      const title = E.titleToName(ctx.title, ctx.pageUrl);
      let res;
      if (s.kind === "m3u8") {
        const sel = btn.parentElement.querySelector("select.dl-q");
        const info = s.info || {};
        const v = info.master && info.variants ? info.variants[sel ? Number(sel.value) : 0] : null;
        res = await UI.send({
          type: "zz:dl:add",
          payload: {
            url: s.url,
            variantUrl: v ? v.url : "",
            mediaUrl: v ? v.url : info.master ? "" : s.url,
            audioUrl: v ? v.audioUrl || "" : "",
            quality: v ? v.label || E.qualityLabel(v) : "",
            live: !!info.live,
            title,
            pageUrl: ctx.pageUrl,
            referrer: s.referer || ctx.pageUrl,
            dir: toolbox.videoDir || "ZeroZen/视频",
          },
        });
      } else {
        res = await UI.send({
          type: "zz:dl:add-file",
          payload: { url: s.url, title, pageUrl: s.referer || ctx.pageUrl, dir: toolbox[s.kind === "audio" ? "audioDir" : "videoDir"] || "ZeroZen/视频" },
        });
      }
      btn.disabled = false;
      btn.textContent = label;
      if (res && res.ok) {
        if (o.toastEl) UI.toast(o.toastEl, res.duplicate ? T("这个视频已在下载列表里") : T("已开始下载，可关闭弹窗"), "ok");
        if (o.onAdded) o.onAdded(res.task || null, btn);
      } else if (o.toastEl) UI.toast(o.toastEl, T("添加失败：$1", (res && res.error) || T("未知错误")), "err");
    });

    return { refresh: load, context: () => ctx };
  }

  // ---------------- 任务列表 ----------------

  const STATUS = {
    queued: () => T("排队中"),
    running: () => T("下载中"),
    paused: () => T("已暂停"),
    error: () => T("失败"),
    done: () => T("已完成"),
    canceled: () => T("已取消"),
  };

  function pct(t) {
    const p = t.progress || {};
    if (t.status === "done") return 100;
    if (t.kind === "file") return p.total ? Math.min(100, Math.round((p.bytes / p.total) * 100)) : 0;
    return p.total ? Math.min(100, Math.floor((p.done / p.total) * 100)) : 0;
  }

  function eta(sec) {
    if (!sec || !isFinite(sec)) return "";
    if (sec < 60) return T("约 $1 秒", Math.ceil(sec));
    if (sec < 3600) return T("约 $1 分钟", Math.ceil(sec / 60));
    return T("约 $1 小时", (sec / 3600).toFixed(1));
  }

  function metaLine(t) {
    const p = t.progress || {};
    const parts = [];
    if (t.status === "running") {
      if (t.phase) parts.push(t.phase);
      if (t.kind === "hls" && p.total) parts.push(T("分片 $1/$2", p.done || 0, p.total));
      if (p.bytes) parts.push(E.bytes(p.bytes) + (t.kind === "file" && p.total ? " / " + E.bytes(p.total) : ""));
      if (t.speed) parts.push(E.bytes(t.speed) + "/s");
      // eta() 自带「约」，这里不要再套「剩余」，否则显示成「剩余 约 3 分钟」
      if (t.eta) parts.push(eta(t.eta));
      if (t.live && p.duration) parts.push(T("已录 $1", E.duration(p.duration)));
    } else if (t.status === "done") {
      if (t.size) parts.push(E.bytes(t.size));
      if (t.startedAt && t.finishedAt) parts.push(T("用时 $1", E.duration((t.finishedAt - t.startedAt) / 1000)));
      if (t.saved && t.saved[0]) parts.push(String(t.saved[0]).split(/[\\/]/).slice(-2).join("/"));
    } else if (t.status === "paused" || t.status === "queued") {
      if (p.total) parts.push(t.kind === "hls" ? T("已完成 $1/$2 分片", p.done || 0, p.total) : E.bytes(p.bytes) + " / " + E.bytes(p.total));
    }
    return parts.join(" · ");
  }

  function actions(t, compact) {
    const b = (act, label, cls) => '<button class="zz-btn zz-btn-sm ' + (cls || "") + '" data-act="' + act + '" data-id="' + esc(t.id) + '">' + esc(label) + "</button>";
    const out = [];
    if (t.status === "running" || t.status === "queued") out.push(b("pause", t.live ? T("停止并保存") : T("暂停")));
    if (t.status === "paused") out.push(b("resume", T("继续"), "zz-btn-primary"));
    if (t.status === "error") out.push(b("retry", T("重试"), "zz-btn-primary"));
    if (t.status === "done") out.push(b("show", T("打开文件夹")));
    if (!compact) {
      if (t.status === "error" && t.kind === "hls") out.push(b("fresh", T("重新解析")));
      if (t.url) out.push(b("copy", T("复制链接")));
      if (t.status === "error") out.push(b("report", T("反馈")));
    }
    out.push(b("remove", t.status === "done" ? T("移除") : T("删除"), "zz-btn-ghost"));
    return out.join("");
  }

  function card(t, compact) {
    const p = pct(t);
    const hint = t.status === "error" && t.hint ? t.hint : null;
    return (
      '<div class="dl-task s-' + esc(t.status) + '" data-id="' + esc(t.id) + '">' +
      '<div class="dl-task-top"><span class="dl-task-title" title="' + esc(t.url || "") + '">' + esc(t.title || "—") +
      (t.quality ? ' <em>' + esc(t.quality) + "</em>" : "") + "</span>" +
      '<span class="dl-badge">' + esc((STATUS[t.status] || (() => t.status))()) + (t.status === "running" || t.status === "paused" ? " " + p + "%" : "") + "</span></div>" +
      '<div class="dl-bar"><i style="width:' + (t.status === "error" ? Math.max(p, 4) : p) + '%"></i></div>' +
      '<div class="dl-task-meta">' + esc(metaLine(t)) + "</div>" +
      (hint ? '<div class="dl-task-err"><b>' + esc(hint.reason) + "</b>" + (hint.advice ? " — " + esc(hint.advice) : "") + "</div>" : "") +
      (t.note ? '<div class="dl-task-note">' + esc(t.note) + "</div>" : "") +
      '<div class="dl-task-act">' + actions(t, compact) + "</div>" +
      "</div>"
    );
  }

  /**
   * opts: { compact, limit, filter(t) , toastEl, onChange(tasks), emptyText }
   */
  function taskList(box, opts) {
    const o = opts || {};
    let tasks = [];
    let timer = null;
    let channel = null;

    function draw() {
      let list = tasks.slice();
      if (o.filter) list = list.filter(o.filter);
      if (o.compact) {
        // 弹窗只放进行中 + 最近 3 条
        const active = list.filter((t) => t.status === "running" || t.status === "queued" || t.status === "paused" || t.status === "error");
        const recent = list.filter((t) => t.status === "done").slice(0, Math.max(0, 3 - active.length));
        list = active.concat(recent);
      }
      if (o.limit) list = list.slice(0, o.limit);
      box.innerHTML = list.length ? list.map((t) => card(t, o.compact)).join("") : o.emptyText ? '<div class="dl-empty">' + esc(o.emptyText) + "</div>" : "";
      if (o.onChange) o.onChange(tasks, list);
    }

    function patchOne(task) {
      const i = tasks.findIndex((t) => t.id === task.id);
      if (i >= 0) tasks[i] = Object.assign({}, tasks[i], task);
      else tasks.unshift(task);
      const el = box.querySelector('.dl-task[data-id="' + (g.CSS && CSS.escape ? CSS.escape(task.id) : task.id) + '"]');
      if (el && (!o.filter || o.filter(tasks[Math.max(0, i)]))) {
        const tmp = document.createElement("div");
        tmp.innerHTML = card(i >= 0 ? tasks[i] : task, o.compact);
        el.replaceWith(tmp.firstChild);
        if (o.onChange) o.onChange(tasks);
      } else draw();
    }

    async function load() {
      const res = await UI.send({ type: "zz:dl:list" });
      if (res && res.ok) {
        tasks = res.tasks || [];
        box._cacheBytes = res.cacheBytes || 0;
      }
      draw();
      return res;
    }

    function start() {
      load();
      try {
        channel = new BroadcastChannel("zz-dl");
        channel.onmessage = (ev) => {
          const m = ev.data || {};
          if (m.kind === "task" && m.task) patchOne(m.task);
          else if (m.kind === "removed" && m.task) {
            tasks = tasks.filter((t) => t.id !== m.task.id);
            draw();
          } else if (m.kind === "reload") load();
        };
      } catch (e) {}
      // 浏览器原生下载（直链文件）没有推送：有进行中的原生任务时低频轮询
      timer = setInterval(() => {
        if (document.hidden) return;
        if (tasks.some((t) => t.native && (t.status === "running" || t.status === "paused"))) load();
      }, 1500);
    }

    box.addEventListener("click", async (event) => {
      const btn = event.target.closest("button[data-act]");
      if (!btn || !btn.hasAttribute("data-id")) return;
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-act");
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      const toast = (msg, kind) => o.toastEl && UI.toast(o.toastEl, msg, kind);
      btn.disabled = true;
      try {
        if (act === "pause") await UI.send({ type: "zz:dl:pause", payload: { id } });
        else if (act === "resume") {
          if (!(await UI.ensurePermission("downloads"))) return toast(T("需要「下载」权限才能保存文件"), "err");
          await UI.send({ type: "zz:dl:resume", payload: { id } });
        } else if (act === "retry" || act === "fresh") {
          if (!(await UI.ensurePermission("downloads"))) return toast(T("需要「下载」权限才能保存文件"), "err");
          if (t.native) await UI.send({ type: "zz:dl:resume", payload: { id } });
          else await UI.send({ type: "zz:dl:retry", payload: { id, fresh: act === "fresh" } });
        } else if (act === "show") {
          const r = await UI.send({ type: "zz:dl:show", payload: { downloadIds: t.downloadIds || (t.downloadId !== undefined ? [t.downloadId] : []) } });
          if (r && !r.ok) toast(r.error || T("操作失败"), "err");
        } else if (act === "copy") {
          await navigator.clipboard.writeText(t.url || "");
          toast(T("链接已复制"), "ok");
        } else if (act === "report") {
          const report = E.buildReport(t);
          try {
            await navigator.clipboard.writeText(report);
          } catch (e) {}
          api.tabs.create({ url: E.issueUrl(report) });
        } else if (act === "remove") {
          // 有进度的未完成任务：二次确认（不用 confirm()，弹窗里会被浏览器吞掉）
          const risky = t.status !== "done" && t.status !== "canceled" && t.progress && (t.progress.done || t.progress.bytes);
          if (risky && btn.getAttribute("data-armed") !== "1") {
            btn.setAttribute("data-armed", "1");
            btn.textContent = T("再点一次删除");
            btn.classList.add("zz-btn-danger");
            setTimeout(() => {
              if (btn.isConnected) {
                btn.removeAttribute("data-armed");
                btn.textContent = T("删除");
                btn.classList.remove("zz-btn-danger");
              }
            }, 3000);
            return;
          }
          await UI.send({ type: "zz:dl:remove", payload: { id } });
          tasks = tasks.filter((x) => x.id !== id);
          draw();
        }
        if (t.native || act === "remove") setTimeout(load, 300);
      } finally {
        if (btn.isConnected) btn.disabled = false;
      }
    });

    start();
    return {
      refresh: load,
      tasks: () => tasks,
      setFilter(fn) {
        o.filter = fn;
        draw();
      },
      stop() {
        if (timer) clearInterval(timer);
        if (channel) channel.close();
      },
    };
  }

  g.ZZDLUI = { mediaList, taskList, esc, settings };
})();

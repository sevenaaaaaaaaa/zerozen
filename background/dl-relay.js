// 下载中继（后台）：负责把下载宿主拉起来并转发命令；替宿主调用它拿不到的扩展 API
// （downloads 写盘、DNR Referer 伪装、系统通知）。宿主本身见 ui/dl-host.js。
//
//   界面 ──zz:dl:*──▶ 后台（本文件）──zz:dlhost──▶ 宿主（offscreen / 后台页内嵌帧 / 兜底固定标签页）
//   宿主 ──zz:dlsw:*──▶ 后台：保存文件、伪装 Referer、通知、空闲关闭
(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;
  const HOST_PATH = "ui/dl-host.html";

  let creating = null;
  let frame = null;
  const NATIVE_KEY = "zz.dl.native";

  async function hostAlive() {
    try {
      const res = await api.runtime.sendMessage({ type: "zz:dlhost", cmd: "ping" });
      return !!(res && res.ok);
    } catch (e) {
      return false;
    }
  }

  async function createHost() {
    const off = typeof chrome !== "undefined" && chrome.offscreen;
    if (off && off.createDocument) {
      let exists = false;
      try {
        if (api.runtime.getContexts) {
          const ctx = await api.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
          exists = ctx.length > 0;
        } else if (off.hasDocument) exists = await off.hasDocument();
      } catch (e) {}
      if (!exists) {
        try {
          await off.createDocument({
            url: HOST_PATH,
            reasons: ["BLOBS"],
            justification: "Download HLS segments in the background and assemble them into a video file",
          });
        } catch (e) {
          if (!/single offscreen|already/i.test(String(e && e.message))) throw e;
        }
      }
      return;
    }
    if (typeof document !== "undefined" && document.body !== undefined) {
      // Firefox / Safari 事件页：后台页本身有 DOM，内嵌一个宿主帧
      if (!frame || !frame.isConnected) {
        frame = document.createElement("iframe");
        frame.src = api.runtime.getURL(HOST_PATH);
        (document.body || document.documentElement).appendChild(frame);
      }
      return;
    }
    // 兜底：固定的非活动标签页
    const url = api.runtime.getURL(HOST_PATH);
    const tabs = await ZZ.call(api.tabs, "query", { url });
    if (!tabs || !tabs.length) await ZZ.call(api.tabs, "create", { url, active: false, pinned: true });
  }

  async function ensureHost() {
    if (await hostAlive()) return true;
    if (!creating) {
      creating = (async () => {
        await createHost();
        for (let i = 0; i < 40; i++) {
          if (await hostAlive()) {
            await pushConfig();
            return true;
          }
          await ZZ.sleep(100);
        }
        return false;
      })().finally(() => {
        creating = null;
      });
    }
    return creating;
  }

  async function pushConfig() {
    const tb = (ZZ.Store && ZZ.Store.settings().toolbox) || {};
    try {
      await api.runtime.sendMessage({
        type: "zz:dlhost",
        cmd: "config",
        payload: {
          maxTasks: Math.max(1, Math.min(5, Number(tb.maxTasks) || 2)),
          concurrency: Math.max(1, Math.min(12, Number(tb.concurrency) || 6)),
          keepTs: tb.keepTs === true,
          lang: ZZ.I18n && ZZ.I18n.lang ? ZZ.I18n.lang() : "",
        },
      });
    } catch (e) {}
  }

  async function call(cmd, payload) {
    const ok = await ensureHost();
    if (!ok) return { ok: false, error: ZZ.T("下载服务启动失败，请到扩展管理页重载 ZeroZen") };
    try {
      const res = await api.runtime.sendMessage({ type: "zz:dlhost", cmd, payload: payload || {} });
      return res || { ok: false, error: "no response" };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  function downloadsApi() {
    return api.downloads && api.downloads.download ? api.downloads : null;
  }

  function dl(opts) {
    const d = downloadsApi();
    if (!d) return Promise.reject(new Error(ZZ.T("需要授予「下载」权限")));
    return new Promise((resolve, reject) => {
      try {
        const ret = d.download(opts, (id) => {
          const err = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError;
          if (err || id === undefined) reject(new Error((err && err.message) || "download failed"));
          else resolve(id);
        });
        if (ret && typeof ret.then === "function") ret.then(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  // 文件名被浏览器拒绝（系统编码不支持中文、保留名等）时退回 ASCII 安全名，绝不让下好的视频因命名丢失
  async function dlSafe(opts) {
    try {
      return { id: await dl(opts), filename: opts.filename };
    } catch (e) {
      if (!/invalid filename/i.test(String(e && e.message))) throw e;
      const ext = (String(opts.filename).match(/\.([a-z0-9]{1,5})$/i) || [])[1] || "bin";
      const ascii = String(opts.filename)
        .split("/")
        .map((seg) => seg.normalize("NFKD").replace(/[^\w.\- ()\[\]]+/g, "").trim())
        .filter(Boolean);
      const name = ascii.pop() || "";
      const fallback = (ascii.length ? ascii.join("/") + "/" : "ZeroZen/") + (name && name !== "." + ext ? name : "video-" + new Date().toISOString().replace(/[:.]/g, "-") + "." + ext);
      return { id: await dl(Object.assign({}, opts, { filename: fallback })), filename: fallback };
    }
  }

  async function search(query) {
    const d = downloadsApi();
    if (!d || !d.search) return [];
    try {
      return (await ZZ.call(d, "search", query)) || [];
    } catch (e) {
      return [];
    }
  }

  // ---- 直链文件：交给浏览器原生下载（自带断点续传与系统级管理），我们只登记与展示 ----

  async function nativeList() {
    try {
      const res = await api.storage.local.get(NATIVE_KEY);
      return Array.isArray(res[NATIVE_KEY]) ? res[NATIVE_KEY] : [];
    } catch (e) {
      return [];
    }
  }

  async function nativeSave(list) {
    try {
      await api.storage.local.set({ [NATIVE_KEY]: list.slice(0, 200) });
    } catch (e) {}
  }

  function nativeView(rec, item) {
    const it = item || {};
    const state = it.state || "interrupted";
    const status =
      state === "complete" ? "done" : state === "in_progress" ? (it.paused ? "paused" : "running") : it.error === "USER_CANCELED" ? "canceled" : "error";
    const hint = status === "error" ? globalThis.ZZDLEngine.errorHint({ error: it.error || "" }) : null;
    return {
      v: 2,
      id: "n" + rec.downloadId,
      kind: "file",
      native: true,
      downloadId: rec.downloadId,
      url: rec.url,
      pageUrl: rec.pageUrl || "",
      title: rec.title,
      status: item ? status : "error",
      error: item ? it.error || "" : ZZ.T("浏览器下载记录已被清除"),
      hint,
      saved: it.filename ? [it.filename] : [],
      exists: it.exists !== false,
      progress: { bytes: it.bytesReceived || 0, total: it.totalBytes || 0 },
      size: it.totalBytes || it.fileSize || 0,
      speed: 0,
      createdAt: rec.at,
      finishedAt: it.endTime ? Date.parse(it.endTime) : 0,
      canResume: !!it.canResume,
    };
  }

  const speedTrack = new Map(); // downloadId -> [t, bytes]

  async function listNative() {
    const recs = await nativeList();
    if (!recs.length) return [];
    const items = await search({});
    const byId = new Map(items.map((x) => [x.id, x]));
    const now = Date.now();
    return recs.map((r) => {
      const item = byId.get(r.downloadId);
      const v = nativeView(r, item);
      if (item && item.state === "in_progress") {
        const prev = speedTrack.get(r.downloadId);
        if (prev && now - prev[0] > 300) v.speed = ((item.bytesReceived - prev[1]) * 1000) / (now - prev[0]);
        speedTrack.set(r.downloadId, [now, item.bytesReceived || 0]);
        // 原生下载也给出剩余时间：按当前速度估算，界面里与其他任务一致
        if (v.speed > 0 && v.progress.total > v.progress.bytes) v.eta = (v.progress.total - v.progress.bytes) / v.speed;
      }
      return v;
    });
  }

  async function addFile(p) {
    const url = String(p.url || "");
    if (!/^https?:/i.test(url)) return { ok: false, error: ZZ.T("无效地址") };
    const E = globalThis.ZZDLEngine;
    const ext = (E && E.extOf(url)) || "";
    const base = (p.title && E ? E.sanitize(p.title) : "") || (E ? E.nameFromUrl(url) : "download");
    const name = /\.[a-z0-9]{1,5}$/i.test(base) ? base : base + (ext ? "." + ext : "");
    const dir = String(p.dir || "ZeroZen/下载").replace(/^\/+|\/+$/g, "");
    // 防盗链：下载请求类型为 other，临时给目标域名补 Referer
    const spoof = p.pageUrl ? await ZZ.FetchSpoof.acquire(url, p.pageUrl, ["other", "media", "xmlhttprequest"]) : null;
    try {
      const { id } = await dlSafe({ url, filename: dir + "/" + name, conflictAction: "uniquify", saveAs: false });
      const list = await nativeList();
      list.unshift({ downloadId: id, url, pageUrl: p.pageUrl || "", title: name, at: Date.now() });
      await nativeSave(list);
      return { ok: true, downloadId: id };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    } finally {
      if (spoof) setTimeout(() => ZZ.FetchSpoof.release(spoof), 60000);
    }
  }

  async function nativeAction(id, action) {
    const d = downloadsApi();
    const downloadId = Number(String(id).slice(1));
    if (!d) return { ok: false, error: ZZ.T("需要授予「下载」权限") };
    try {
      if (action === "pause") await ZZ.call(d, "pause", downloadId);
      else if (action === "resume") {
        const [item] = await search({ id: downloadId });
        if (item && item.canResume) await ZZ.call(d, "resume", downloadId);
        else {
          const rec = (await nativeList()).find((r) => r.downloadId === downloadId);
          if (rec) {
            await nativeRemove([id]);
            return addFile({ url: rec.url, pageUrl: rec.pageUrl, title: rec.title });
          }
        }
      } else if (action === "cancel") await ZZ.call(d, "cancel", downloadId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  async function nativeRemove(ids) {
    const nums = ids.map((x) => Number(String(x).slice(1)));
    const d = downloadsApi();
    for (const n of nums) {
      try {
        const [item] = await search({ id: n });
        if (item && item.state === "in_progress") await ZZ.call(d, "cancel", n);
      } catch (e) {}
    }
    await nativeSave((await nativeList()).filter((r) => nums.indexOf(r.downloadId) < 0));
    return { ok: true };
  }

  async function notify(p) {
    try {
      const tb = ZZ.Store.settings().toolbox || {};
      if (!tb.notifyDone || !api.notifications || !api.notifications.create) return;
      await ZZ.call(api.notifications, "create", {
        type: "basic",
        iconUrl: api.runtime.getURL("icons/icon128.png"),
        title: p.ok ? ZZ.T("ZeroZen 下载完成") : ZZ.T("ZeroZen 下载失败"),
        message: String(p.ok ? p.filename || p.title || "" : (p.title || "") + "：" + (p.error || "")).slice(0, 200),
      });
    } catch (e) {}
  }

  const HOST_CMDS = { "zz:dl:add": "add", "zz:dl:retry": "retry", "zz:dl:rename": "rename", "zz:dl:probe": "probe", "zz:dl:clear-done": "clearDone", "zz:dl:clear-cache": "clearCache" };

  async function handle(msg) {
    const p = msg.payload || {};
    switch (msg.type) {
      case "zz:dl:list": {
        const [host, native] = await Promise.all([call("list"), listNative()]);
        const tasks = ((host && host.tasks) || []).concat(native).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return { ok: true, tasks, cacheBytes: (host && host.cacheBytes) || 0, hostError: host && !host.ok ? host.error : "" };
      }
      case "zz:dl:config":
        await pushConfig();
        return { ok: true };
      case "zz:dl:add-file":
        return addFile(p);
      case "zz:dl:pause":
      case "zz:dl:resume":
        if (String(p.id || "").startsWith("n")) return nativeAction(p.id, msg.type === "zz:dl:pause" ? "pause" : "resume");
        return call(msg.type === "zz:dl:pause" ? "pause" : "resume", p);
      case "zz:dl:remove": {
        const ids = Array.isArray(p.ids) ? p.ids : [p.id];
        const nat = ids.filter((x) => String(x).startsWith("n"));
        const hls = ids.filter((x) => !String(x).startsWith("n"));
        if (nat.length) await nativeRemove(nat);
        if (hls.length) return call("remove", { ids: hls });
        return { ok: true };
      }
      case "zz:dl:clear-done": {
        const native = await listNative();
        await nativeSave((await nativeList()).filter((r) => {
          const v = native.find((x) => x.downloadId === r.downloadId);
          return v && v.status !== "done" && v.status !== "canceled";
        }));
        return call("clearDone", p);
      }
      case "zz:dl:show": {
        const d = downloadsApi();
        if (!d) return { ok: false, error: ZZ.T("需要授予「下载」权限") };
        const ids = (p.downloadIds || []).filter((x) => typeof x === "number");
        try {
          if (ids.length) d.show(ids[0]);
          else if (d.showDefaultFolder) d.showDefaultFolder();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
      case "zz:dl:open-center": {
        const url = api.runtime.getURL("ui/downloads.html");
        const tabs = await ZZ.call(api.tabs, "query", { url: url + "*" });
        if (tabs && tabs[0]) {
          await ZZ.call(api.tabs, "update", tabs[0].id, { active: true });
          if (tabs[0].windowId !== undefined && api.windows) ZZ.call(api.windows, "update", tabs[0].windowId, { focused: true }).catch(() => {});
        } else await ZZ.call(api.tabs, "create", { url: url + (p.focus ? "#" + encodeURIComponent(p.focus) : "") });
        return { ok: true };
      }
      // —— 宿主 → 后台 ——
      case "zz:dlsw:save": {
        try {
          const r = await dlSafe({ url: p.url, filename: p.filename, conflictAction: "uniquify", saveAs: false });
          const [item] = await search({ id: r.id });
          return { ok: true, downloadId: r.id, filename: (item && item.filename) || r.filename };
        } catch (e) {
          return { ok: false, error: (e && e.message) || String(e) };
        }
      }
      case "zz:dlsw:spoof": {
        const token = await ZZ.FetchSpoof.acquire(p.url, p.referrer || "");
        return { ok: true, token };
      }
      case "zz:dlsw:unspoof":
        ZZ.FetchSpoof.release(p.token);
        return { ok: true };
      case "zz:dlsw:notify":
        notify(p);
        return { ok: true };
      case "zz:dlsw:idle": {
        try {
          if (typeof chrome !== "undefined" && chrome.offscreen && chrome.offscreen.closeDocument) await chrome.offscreen.closeDocument();
        } catch (e) {}
        return { ok: true };
      }
      default:
        if (HOST_CMDS[msg.type]) return call(HOST_CMDS[msg.type], p);
        return undefined;
    }
  }

  // 浏览器启动：有未完成的下载就把宿主拉起来自动续传
  async function resumeOnStartup() {
    try {
      if (!globalThis.ZZDLStore) return;
      const tasks = await globalThis.ZZDLStore.listTasks();
      if (tasks.some((t) => t.v === 2 && (t.status === "running" || t.status === "queued"))) await ensureHost();
    } catch (e) {}
  }

  ZZ.DL = { ensureHost, call, handle, resumeOnStartup, pushConfig };
  if (api.runtime && api.runtime.onStartup) api.runtime.onStartup.addListener(() => resumeOnStartup());
})();

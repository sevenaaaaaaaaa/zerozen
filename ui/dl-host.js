// 下载宿主：唯一的下载任务管理者（队列、状态机、进度广播、断点续传、启动恢复）。
// Chrome：由后台以 offscreen 文档常驻；Firefox：后台页内嵌帧；都不受 popup / 标签页开关影响。
//
// 任务状态：queued → running → (merging) → done
//                      ↘ paused（用户暂停 / 浏览器重启中断，可继续）
//                      ↘ error（可重试，分片保留）
// 进度通过 BroadcastChannel("zz-dl") 推送给所有打开的界面（popup / 下载中心 / 工具箱）。
(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;
  const T = ZZ.T;
  const Store = globalThis.ZZDLStore;
  const E = globalThis.ZZDLEngine;

  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("zz-dl") : null;
  const running = new Map(); // id -> { abort: AbortController, stopping: "pause"|"remove"|"stop" }
  const live = new Map(); // id -> 运行时进度（速度、阶段），不落盘
  let settings = { maxTasks: 2, concurrency: 6, keepTs: false, liveMaxMinutes: 240 };
  let idleTimer = null;

  function sw(type, payload) {
    return new Promise((resolve) => {
      try {
        const ret = api.runtime.sendMessage({ type, payload });
        if (ret && ret.then) ret.then((r) => resolve(r || null)).catch(() => resolve(null));
        else resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  E.init({
    T,
    spoof: async (url, referrer) => {
      const res = await sw("zz:dlsw:spoof", { url, referrer });
      return res && res.token;
    },
    unspoof: (token) => sw("zz:dlsw:unspoof", { token }),
  });

  function view(task) {
    const rt = live.get(task.id) || {};
    return { ...task, speed: rt.speed || 0, phase: rt.phase || task.phase || "", eta: rt.eta || 0 };
  }

  function broadcast(task, kind) {
    try {
      if (channel) channel.postMessage({ kind: kind || "task", task: task ? view(task) : null });
    } catch (e) {}
  }

  async function save(task, patch) {
    Object.assign(task, patch || {});
    task.v = 2;
    await Store.putTask(task);
    broadcast(task);
    return task;
  }

  async function allTasks() {
    return (await Store.listTasks()).filter((t) => t.v === 2);
  }

  // ---------------- 保存到磁盘 ----------------

  async function saveBlob(task, blob, ext, suffix) {
    const base = E.sanitize(task.title || "video") + (task.quality && task.quality !== "best" ? " [" + task.quality + "]" : "") + (suffix || "");
    const filename = (task.dir || "ZeroZen/视频").replace(/^\/+|\/+$/g, "") + "/" + E.sanitize(base) + "." + ext;
    const url = URL.createObjectURL(blob);
    const res = await sw("zz:dlsw:save", { url, filename, taskId: task.id, size: blob.size });
    // blob URL 需要活到浏览器把文件写完；大文件写盘可能要几分钟
    setTimeout(() => URL.revokeObjectURL(url), Math.max(120000, (blob.size / (20 * 1024 * 1024)) * 1000 + 120000));
    if (!res || !res.ok) throw new Error((res && res.error) || T("保存失败"));
    return { filename: res.filename || filename, downloadId: res.downloadId, size: blob.size };
  }

  // ---------------- 执行 ----------------

  async function runTask(task) {
    const abort = new AbortController();
    const slot = { abort, stopping: "" };
    running.set(task.id, slot);
    const rt = { speed: 0, phase: "", eta: 0, samples: [] };
    live.set(task.id, rt);
    await save(task, { status: "running", error: "", hint: null, startedAt: task.startedAt || Date.now(), note: task.note || "" });
    try {
      if (task.kind !== "hls") throw new Error("unsupported task kind");
      const res = await E.runHls(task, {
        signal: abort.signal,
        concurrency: settings.concurrency,
        liveMaxMinutes: settings.liveMaxMinutes,
        onStats: (st) => {
          const now = Date.now();
          rt.samples.push([now, st.bytes]);
          while (rt.samples.length > 2 && now - rt.samples[0][0] > 6000) rt.samples.shift();
          const [t0, b0] = rt.samples[0];
          rt.speed = now - t0 > 500 ? ((st.bytes - b0) * 1000) / (now - t0) : rt.speed;
          const left = st.total - st.done;
          rt.eta = rt.speed > 0 && st.done > 0 && !task.live ? ((st.bytes / st.done) * left) / rt.speed : 0;
          task.progress = { done: st.done, total: st.total, bytes: st.bytes, duration: st.duration || 0 };
          broadcast(task);
          persistProgress(task);
        },
        phase: (text) => {
          rt.phase = text;
          broadcast(task);
        },
        note: (text) => {
          task.note = text;
          broadcast(task);
        },
        update: (patch) => save(task, patch),
        save: (blob, ext, suffix) => saveBlob(task, blob, ext, suffix),
      });
      persistProgress.cancel();
      rt.phase = "";
      await Store.clearChunks(task.id);
      await save(task, {
        status: "done",
        finishedAt: Date.now(),
        saved: res.saved.map((s) => s.filename),
        downloadIds: res.saved.map((s) => s.downloadId).filter((x) => x !== undefined),
        size: res.size,
      });
      sw("zz:dlsw:notify", { ok: true, title: task.title, filename: res.saved[0] && res.saved[0].filename });
    } catch (e) {
      persistProgress.cancel();
      rt.phase = "";
      if (slot.stopping === "remove") {
        // 删除流程自己清理
      } else if (slot.stopping === "pause" || (e && e.name === "AbortError") || abort.signal.aborted) {
        await save(task, { status: "paused" });
      } else {
        const msg = String((e && e.message) || e);
        await save(task, { status: "error", error: msg, hint: E.errorHint({ message: msg }) });
        sw("zz:dlsw:notify", { ok: false, title: task.title, error: msg });
      }
    } finally {
      running.delete(task.id);
      live.delete(task.id);
      pump();
    }
  }

  // 进度落盘节流：浏览器意外关闭后能显示接近真实的进度
  const persistProgress = E.throttle((task) => {
    if (running.has(task.id)) Store.putTask(task).catch(() => {});
  }, 3000);

  async function pump() {
    const tasks = await allTasks();
    const active = running.size;
    const slots = Math.max(1, settings.maxTasks) - active;
    if (slots > 0) {
      const queued = tasks.filter((t) => t.status === "queued" && !running.has(t.id)).sort((a, b) => a.createdAt - b.createdAt);
      for (const t of queued.slice(0, slots)) runTask(t);
    }
    // 空闲 3 分钟后通知后台可以关闭宿主，释放内存
    if (idleTimer) clearTimeout(idleTimer);
    if (!running.size && !tasks.some((t) => t.status === "queued")) {
      idleTimer = setTimeout(() => {
        if (!running.size) sw("zz:dlsw:idle", {});
      }, 180000);
    }
  }

  // ---------------- 命令 ----------------

  async function add(p) {
    const url = String(p.url || "");
    if (!/^https?:/i.test(url)) throw new Error(T("无效地址"));
    const tasks = await allTasks();
    const key = p.variantUrl || url;
    const dup = tasks.find((t) => (t.variantUrl || t.url) === key && t.status !== "done");
    if (dup) {
      if (dup.status === "paused" || dup.status === "error") await save(dup, { status: "queued" });
      pump();
      return { task: view(dup), duplicate: true };
    }
    const task = {
      v: 2,
      id: Store.taskId("hls", key, String(Date.now())),
      kind: "hls",
      url,
      variantUrl: p.variantUrl || "",
      mediaUrl: p.mediaUrl || "",
      audioUrl: p.audioUrl || "",
      quality: p.quality || "",
      pageUrl: p.pageUrl || "",
      referrer: p.referrer || p.pageUrl || "",
      title: E.sanitize(p.title || E.nameFromUrl(url)),
      dir: p.dir || "ZeroZen/视频",
      keepTs: p.keepTs !== undefined ? !!p.keepTs : settings.keepTs,
      live: !!p.live,
      status: "queued",
      progress: { done: 0, total: 0, bytes: 0 },
      createdAt: Date.now(),
    };
    await save(task);
    pump();
    return { task: view(task) };
  }

  async function stopRunning(id, why) {
    const slot = running.get(id);
    if (!slot) return false;
    slot.stopping = why;
    slot.abort.abort(Object.assign(new Error("paused"), { name: "AbortError" }));
    for (let i = 0; i < 100 && running.has(id); i++) await new Promise((r) => setTimeout(r, 50));
    return true;
  }

  const commands = {
    async ping() {
      return { ok: true };
    },
    async config(p) {
      settings = Object.assign(settings, p || {});
      if (p && p.lang && ZZ.I18n && ZZ.I18n.setLang) ZZ.I18n.setLang(p.lang);
      pump();
      return { ok: true };
    },
    async add(p) {
      return { ok: true, ...(await add(p || {})) };
    },
    async list() {
      const tasks = await allTasks();
      const cache = await Store.cacheSummary().catch(() => ({ total: 0 }));
      return { ok: true, tasks: tasks.map(view), cacheBytes: cache.total || 0 };
    },
    async pause(p) {
      const t = await Store.getTask(p.id);
      if (!t) return { ok: false, error: T("任务不存在") };
      if (running.has(t.id)) await stopRunning(t.id, t.live ? "stop" : "pause");
      else if (t.status === "queued") await save(t, { status: "paused" });
      return { ok: true };
    },
    async resume(p) {
      const t = await Store.getTask(p.id);
      if (!t) return { ok: false, error: T("任务不存在") };
      if (t.status !== "running") await save(t, { status: "queued", error: "", hint: null });
      pump();
      return { ok: true };
    },
    async retry(p) {
      const t = await Store.getTask(p.id);
      if (!t) return { ok: false, error: T("任务不存在") };
      // 失效链接：清掉媒体地址，从原地址重新解析（分片键按序号，播放列表不变时仍可续传）
      const patch = { status: "queued", error: "", hint: null };
      if (p.fresh) Object.assign(patch, { mediaUrl: "", audioUrl: "" });
      await save(t, patch);
      pump();
      return { ok: true };
    },
    async remove(p) {
      const ids = Array.isArray(p.ids) ? p.ids : [p.id];
      for (const id of ids) {
        await stopRunning(id, "remove");
        await Store.removeTask(id);
        broadcast({ id, removed: true }, "removed");
      }
      pump();
      return { ok: true };
    },
    async clearDone() {
      for (const t of await allTasks()) {
        if (t.status === "done") await Store.removeTask(t.id);
      }
      broadcast(null, "reload");
      return { ok: true };
    },
    async rename(p) {
      const t = await Store.getTask(p.id);
      if (!t) return { ok: false, error: T("任务不存在") };
      await save(t, { title: E.sanitize(p.title || t.title) });
      return { ok: true };
    },
    async probe(p) {
      try {
        const ctx = { referrer: p.referrer || "", spoofed: new Set(), tokens: [] };
        const info = await E.probeM3u8(p.url, ctx);
        return { ok: true, info };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    async clearCache() {
      for (const t of await allTasks()) {
        if (!running.has(t.id) && t.status !== "done") await Store.removeTask(t.id);
      }
      await Store.clearOrphans((await allTasks()).map((t) => t.id));
      broadcast(null, "reload");
      return { ok: true };
    },
  };

  // 启动恢复：上次运行中被打断（浏览器关闭/扩展重载）的任务自动继续；迁移旧版未完成任务
  async function recover() {
    const all = await Store.listTasks();
    for (const t of all) {
      if (t.v === 2) {
        if (t.status === "running" || t.status === "merging") await save(t, { status: "queued" });
        continue;
      }
      // 旧版（v1）记录：m3u8 未完成任务按原 id 迁移（分片键兼容），其余丢弃
      if (t.kind === "m3u8" && !t.queued && t.status !== "done" && (t.mediaUrl || t.url)) {
        await Store.putTask({
          v: 2,
          id: t.id,
          kind: "hls",
          url: t.url,
          variantUrl: "",
          mediaUrl: t.mediaUrl || t.url,
          audioUrl: "",
          quality: "",
          pageUrl: "",
          referrer: "",
          title: E.sanitize(t.nameBase || "video"),
          dir: t.dir || "ZeroZen/视频",
          keepTs: false,
          status: "paused",
          progress: { done: t.done || 0, total: t.total || 0, bytes: 0 },
          createdAt: t.createdAt || Date.now(),
        });
      } else {
        await Store.removeTask(t.id);
      }
    }
    pump();
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "zz:dlhost") return false;
    const fn = commands[msg.cmd];
    if (!fn) {
      sendResponse({ ok: false, error: "unknown command " + msg.cmd });
      return false;
    }
    Promise.resolve()
      .then(() => fn(msg.payload || {}))
      .then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  });

  globalThis.ZZDLHost = { commands, ready: recover() };
})();

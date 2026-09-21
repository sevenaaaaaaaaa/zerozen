// 断点续传存储：下载任务元数据与分片数据（Blob）持久化到 IndexedDB。
// 分片以 Blob 落盘，不占堆内存；任务完成后由调用方 removeTask 清理。
(function () {
  const DB_NAME = "zerozen-dl";
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("tasks")) db.createObjectStore("tasks", { keyPath: "id" });
        if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: ["taskId", "key"] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  }

  function req2p(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("indexedDB request failed"));
    });
  }

  function store(db, name, mode) {
    return db.transaction(name, mode).objectStore(name);
  }

  // 分片键空间：["<taskId>", ""] 到 ["<taskId>", "\uffff"]，key 一律转字符串
  function taskRange(id) {
    return IDBKeyRange.bound([id, ""], [id, "\uffff"]);
  }

  async function putTask(task) {
    const db = await open();
    task.updatedAt = Date.now();
    await req2p(store(db, "tasks", "readwrite").put(task));
    return task;
  }

  async function getTask(id) {
    const db = await open();
    return (await req2p(store(db, "tasks", "readonly").get(id))) || null;
  }

  async function listTasks() {
    const db = await open();
    const all = await req2p(store(db, "tasks", "readonly").getAll());
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function removeTask(id) {
    const db = await open();
    await req2p(store(db, "tasks", "readwrite").delete(id));
    await req2p(store(db, "chunks", "readwrite").delete(taskRange(id)));
  }

  async function saveChunk(taskId, key, data) {
    const db = await open();
    const blob = data instanceof Blob ? data : new Blob([data]);
    await req2p(store(db, "chunks", "readwrite").put({ taskId, key: String(key), blob, size: blob.size, at: Date.now() }));
    return blob.size;
  }

  async function getChunk(taskId, key) {
    const db = await open();
    const row = await req2p(store(db, "chunks", "readonly").get([taskId, String(key)]));
    return row ? row.blob : null;
  }

  async function chunkKeys(taskId) {
    const db = await open();
    const keys = await req2p(store(db, "chunks", "readonly").getAllKeys(taskRange(taskId)));
    return keys.map((k) => k[1]);
  }

  async function chunkSizes(taskId) {
    const db = await open();
    const rows = await req2p(store(db, "chunks", "readonly").getAll(taskRange(taskId)));
    const sizes = {};
    let total = 0;
    for (const r of rows) {
      sizes[r.key] = r.size || 0;
      total += r.size || 0;
    }
    return { sizes, total };
  }

  // 按给定 key 顺序读出分片 Blob（IDB 里的 Blob 是磁盘引用，读取不会整体载入内存）
  async function readChunks(taskId, keys) {
    const out = [];
    for (const k of keys) {
      const b = await getChunk(taskId, k);
      if (b) out.push(b);
    }
    return out;
  }

  function taskId(...parts) {
    const s = parts.join("|");
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0") + "-" + s.length.toString(36);
  }

  globalThis.ZZDLStore = { putTask, getTask, listTasks, removeTask, saveChunk, getChunk, chunkKeys, chunkSizes, readChunks, taskId };
})();

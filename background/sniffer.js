// 媒体嗅探：按标签页记录页面里出现过的 m3u8 / mpd / 视频直链。
// 三个来源互补：
//   1. webRequest 请求地址（需可选权限 webRequest）
//   2. webRequest 响应头 Content-Type（地址里不带 .m3u8 的接口式播放列表）
//   3. 页面内 fetch/XHR 钩子与 <video> 扫描（content/inject-guard.js + 62-media.js，无需任何可选权限）
// 结果写入 storage.session：MV3 后台被回收后重启也不会丢。
(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;

  const KEY = "zz.sniff";
  const MAX_PER_TAB = 40;
  const MIN_MEDIA_BYTES = 1.5 * 1024 * 1024;
  let byTab = new Map(); // tabId -> Map(url -> entry)
  let loaded = null;
  let saveTimer = null;
  const referers = new Map(); // requestId -> referer

  const session = () => (api.storage && api.storage.session) || null;

  function load() {
    if (loaded) return loaded;
    loaded = (async () => {
      const s = session();
      if (!s) return;
      try {
        const res = await s.get(KEY);
        const raw = (res && res[KEY]) || {};
        for (const [tab, list] of Object.entries(raw)) {
          byTab.set(Number(tab), new Map((list || []).map((e) => [e.url, e])));
        }
      } catch (e) {}
    })();
    return loaded;
  }

  function persist() {
    const s = session();
    if (!s || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const out = {};
      for (const [tab, map] of byTab) out[tab] = Array.from(map.values());
      try {
        s.set({ [KEY]: out });
      } catch (e) {}
    }, 500);
  }

  function classify(url) {
    const path = String(url || "").split(/[?#]/)[0];
    if (/\.m3u8$/i.test(path)) return "m3u8";
    if (/\.mpd$/i.test(path)) return "mpd";
    // 分片与初始化段不是独立可下载的视频
    if (/\.(ts|m4s|m4v\.part|aac|key)$/i.test(path) || /\/(seg|segment|chunk|frag)[-_]?\d+/i.test(path)) return "";
    if (/\.(mp4|webm|mov|mkv|flv|m4v)$/i.test(path)) return "media";
    if (/\.(mp3|m4a|flac|ogg|opus|wav)$/i.test(path)) return "audio";
    if (/m3u8/i.test(url) && !/\.(js|css|json|png|jpg|gif|svg)$/i.test(path)) return "m3u8";
    return "";
  }

  function classifyType(ct) {
    const t = String(ct || "").toLowerCase();
    if (/mpegurl/.test(t)) return "m3u8";
    if (/dash\+xml/.test(t)) return "mpd";
    if (/^video\/(mp4|webm|quicktime|x-matroska|x-flv)/.test(t)) return "media";
    if (/^audio\/(mpeg|mp4|flac|ogg|x-m4a)/.test(t)) return "audio";
    return "";
  }

  async function add(tabId, url, kind, meta) {
    if (typeof tabId !== "number" || tabId < 0 || !url || !kind) return;
    if (!/^https?:/i.test(url)) return;
    await load();
    let map = byTab.get(tabId);
    if (!map) {
      map = new Map();
      byTab.set(tabId, map);
    }
    const m = meta || {};
    const existing = map.get(url);
    if (existing) {
      existing.at = Date.now();
      existing.hits = (existing.hits || 1) + 1;
      if (m.size && !existing.size) existing.size = m.size;
      if (m.referer && !existing.referer) existing.referer = m.referer;
      persist();
      return;
    }
    map.set(url, {
      url,
      kind,
      at: Date.now(),
      hits: 1,
      size: m.size || 0,
      referer: m.referer || "",
      frameUrl: m.frameUrl || "",
      source: m.source || "net",
    });
    if (map.size > MAX_PER_TAB) {
      const oldest = Array.from(map.values()).sort((a, b) => a.at - b.at)[0];
      if (oldest) map.delete(oldest.url);
    }
    persist();
    badge(tabId, map);
  }

  // 工具栏图标角标：本页发现可下载视频时显示数量（拦截计数角标优先，不覆盖）
  function badge(tabId, map) {
    try {
      const n = Array.from(map.values()).filter((e) => e.kind === "m3u8" || e.kind === "media" || e.kind === "mpd").length;
      if (ZZ.Counts && ZZ.Counts.setMediaCount) ZZ.Counts.setMediaCount(tabId, n);
    } catch (e) {}
  }

  function headerOf(headers, name) {
    const h = (headers || []).find((x) => x.name && x.name.toLowerCase() === name);
    return h ? h.value || "" : "";
  }

  let installed = false;

  const Sniffer = {
    classify,
    classifyType,

    install() {
      load();
      if (api.tabs && api.tabs.onRemoved && !Sniffer._tabHook) {
        Sniffer._tabHook = true;
        api.tabs.onRemoved.addListener((tabId) => {
          byTab.delete(tabId);
          persist();
        });
        // 同一标签页跳到别的站点：清掉旧页面的嗅探结果
        if (api.webNavigation && api.webNavigation.onCommitted) {
          api.webNavigation.onCommitted.addListener((d) => {
            if (d.frameId !== 0) return;
            if (/reload/.test(d.transitionType || "")) return;
            const map = byTab.get(d.tabId);
            if (!map || !map.size) return;
            byTab.delete(d.tabId);
            persist();
          });
        }
      }
      if (installed) return;
      const wr = api.webRequest;
      if (!wr || !wr.onBeforeRequest) return;
      installed = true;
      const filter = { urls: ["http://*/*", "https://*/*"] };
      try {
        wr.onBeforeRequest.addListener((d) => {
          const kind = classify(d.url || "");
          if (kind === "m3u8" || kind === "mpd") add(d.tabId, d.url, kind, { referer: referers.get(d.requestId) || "", source: "net" });
        }, filter);
      } catch (e) {
        ZZ.warn("sniffer unavailable", e && e.message);
      }
      // Referer：防盗链站点下载时需要原样带上（Chrome 需 extraHeaders 才能读到）
      try {
        const spec = ["requestHeaders"];
        try {
          wr.onBeforeSendHeaders.addListener(onSend, filter, spec.concat(["extraHeaders"]));
        } catch (e) {
          wr.onBeforeSendHeaders.addListener(onSend, filter, spec);
        }
      } catch (e) {}
      try {
        wr.onHeadersReceived.addListener(
          (d) => {
            const referer = referers.get(d.requestId) || "";
            referers.delete(d.requestId);
            if (d.tabId < 0 || d.statusCode >= 400) return;
            const byUrl = classify(d.url || "");
            const ct = headerOf(d.responseHeaders, "content-type");
            const byType = classifyType(ct);
            const kind = byUrl === "m3u8" || byUrl === "mpd" ? "" : byType || (byUrl === "media" || byUrl === "audio" ? byUrl : "");
            if (!kind) return;
            if (kind === "media" || kind === "audio") {
              // 视频直链：只收够大的完整文件；Range 请求从 Content-Range 取总大小
              const range = headerOf(d.responseHeaders, "content-range");
              const total = range ? parseInt(range.split("/")[1], 10) : parseInt(headerOf(d.responseHeaders, "content-length"), 10);
              if (!(total >= MIN_MEDIA_BYTES)) return;
              if (/\.(ts|m4s)(\?|#|$)/i.test(d.url)) return;
              add(d.tabId, d.url, kind, { size: total, referer, source: "net" });
              return;
            }
            add(d.tabId, d.url, kind, { referer, source: "net" });
          },
          filter,
          ["responseHeaders"]
        );
      } catch (e) {}
      function onSend(d) {
        if (d.tabId < 0) return;
        const ref = headerOf(d.requestHeaders, "referer");
        if (ref) {
          referers.set(d.requestId, ref);
          if (referers.size > 2000) referers.delete(referers.keys().next().value);
        }
      }
    },

    // 页面内钩子 / <video> 扫描上报
    addFromPage(tabId, p, frameUrl) {
      const url = String((p && p.url) || "");
      const kind = (p && p.kind) || classify(url) || classifyType(p && p.type);
      if (!kind || kind === "ts") return;
      add(tabId, url, kind, { referer: frameUrl || "", frameUrl: frameUrl || "", size: p.size || 0, source: "page" });
    },

    async list(tabId) {
      await load();
      return Array.from((byTab.get(tabId) || new Map()).values()).sort((a, b) => b.at - a.at);
    },

    async addManual(tabId, url, kind) {
      await add(tabId, url, kind || classify(url) || "m3u8", { source: "manual" });
      return Sniffer.list(tabId);
    },

    clear(tabId) {
      byTab.delete(tabId);
      persist();
      return [];
    },

    clearAll() {
      byTab.clear();
      persist();
    },
  };

  ZZ.Sniffer = Sniffer;
})();

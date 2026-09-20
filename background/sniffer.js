(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;

  const byTab = new Map();
  const MAX_PER_TAB = 40;

  function add(tabId, url, kind) {
    if (typeof tabId !== "number" || tabId < 0 || !url) return;
    if (!/^https?:/i.test(url)) return;
    let map = byTab.get(tabId);
    if (!map) {
      map = new Map();
      byTab.set(tabId, map);
    }
    const existing = map.get(url);
    if (existing) {
      existing.at = Date.now();
      existing.hits = (existing.hits || 1) + 1;
      return;
    }
    map.set(url, { url, kind: kind || "m3u8", at: Date.now(), hits: 1, title: "" });
    if (map.size > MAX_PER_TAB) {
      const oldest = Array.from(map.entries()).sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) map.delete(oldest[0]);
    }
  }

  function classify(url) {
    if (/\.m3u8(\?|#|$)/i.test(url)) return "m3u8";
    if (/\.mpd(\?|#|$)/i.test(url)) return "mpd";
    if (/\.(mp4|m4s|webm)(\?|#|$)/i.test(url)) return "media";
    if (/m3u8/i.test(url)) return "m3u8";
    if (/\.ts(\?|#|$)/i.test(url)) return "ts";
    return "";
  }

  let installed = false;

  const Sniffer = {
    install() {
      if (installed) return;
      const wr = api.webRequest;
      if (!wr || !wr.onBeforeRequest) return;
      installed = true;
      try {
        wr.onBeforeRequest.addListener(
          (details) => {
            const kind = classify(details.url || "");
            if (!kind || kind === "ts") return;
            add(details.tabId, details.url, kind);
          },
          { urls: ["http://*/*", "https://*/*"] }
        );
      } catch (e) {
        ZZ.warn("sniffer unavailable", e && e.message);
      }
      if (api.tabs && api.tabs.onRemoved) {
        api.tabs.onRemoved.addListener((tabId) => byTab.delete(tabId));
      }
    },

    list(tabId) {
      return Array.from((byTab.get(tabId) || new Map()).values()).sort((a, b) => b.at - a.at);
    },

    addManual(tabId, url, kind) {
      add(tabId, url, kind || classify(url) || "m3u8");
      return Sniffer.list(tabId);
    },

    clear(tabId) {
      byTab.delete(tabId);
      return [];
    },

    clearAll() {
      byTab.clear();
    },
  };

  ZZ.Sniffer = Sniffer;
})();

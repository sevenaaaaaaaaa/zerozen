(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;

  const tabs = new Map();
  const hostTotals = new Map();
  let flushTimer = null;
  let counterInstalled = false;
  const badgeTimers = new Map();

  function bucket(tabId) {
    if (!tabs.has(tabId)) {
      tabs.set(tabId, { network: 0, cosmetic: 0, removed: 0, popups: 0, texts: 0, hosts: new Set() });
    }
    return tabs.get(tabId);
  }

  function flushHostTotals() {
    for (const [host, v] of hostTotals) {
      const patch = {
        hidden: (v.hidden || 0) + (v.cosmetic || 0),
        network: v.network || 0,
        popups: v.popups || 0,
        texts: v.texts || 0,
        removed: v.removed || 0,
        lastSeen: Date.now(),
      };
      ZZ.Store.bumpStat(host, patch);
    }
    hostTotals.clear();
  }

  function scheduleBadge(tabId) {
    if (badgeTimers.has(tabId)) return;
    badgeTimers.set(
      tabId,
      setTimeout(() => {
        badgeTimers.delete(tabId);
        Counts.updateBadge(tabId);
      }, 300)
    );
  }

  const Counts = {
    inc(tabId, type, host, n) {
      if (typeof tabId !== "number" || tabId < 0) return;
      const b = bucket(tabId);
      b[type] = (b[type] || 0) + (n || 1);
      if (host) b.hosts.add(host);
      scheduleBadge(tabId);
      if (host) Counts.bumpHost(host, type, n || 1);
    },

    bumpHost(host, type, n) {
      const cur = hostTotals.get(host) || { hidden: 0, cosmetic: 0, network: 0, popups: 0, texts: 0, removed: 0 };
      cur[type] = (cur[type] || 0) + n;
      hostTotals.set(host, cur);
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushHostTotals();
      }, 3000);
    },

    get(tabId) {
      const b = tabs.get(tabId);
      if (!b) return { network: 0, cosmetic: 0, removed: 0, popups: 0, texts: 0, total: 0 };
      return {
        network: b.network,
        cosmetic: b.cosmetic,
        removed: b.removed,
        popups: b.popups,
        texts: b.texts,
        total: b.network + b.cosmetic + b.removed + b.popups + b.texts,
      };
    },

    reset(tabId) {
      tabs.delete(tabId);
      if (badgeTimers.has(tabId)) {
        clearTimeout(badgeTimers.get(tabId));
        badgeTimers.delete(tabId);
      }
      Counts.updateBadge(tabId);
    },

    updateBadge(tabId) {
      if (typeof tabId !== "number" || tabId < 0) return;
      if (!api.action || !api.action.setBadgeText) return;
      const settings = ZZ.Store.settings();
      if (!settings.badge) {
        ZZ.call(api.action, "setBadgeText", { tabId, text: "" }).catch(() => {});
        return;
      }
      const c = Counts.get(tabId);
      const text = c.total > 0 ? String(c.total > 999 ? "999+" : c.total) : "";
      ZZ.call(api.action, "setBadgeText", { tabId, text }).catch(() => {});
      if (api.action.setBadgeBackgroundColor) {
        ZZ.call(api.action, "setBadgeBackgroundColor", { tabId, color: "#3b82f6" }).catch(() => {});
      }
      if (api.action.setTitle) {
        ZZ.call(api.action, "setTitle", {
          tabId,
          title: text ? "ZeroZen：本页已净化 " + c.total + " 项" : "ZeroZen 广告净化器",
        }).catch(() => {});
      }
    },

    installNetworkCounter() {
      if (counterInstalled) return;
      // webRequest 是可选权限：还没授权时不要把标志位置上，
      // 否则用户稍后授权也不会再挂监听器
      const wr = api.webRequest;
      if (!wr || !wr.onBeforeRequest) return;
      counterInstalled = true;
      const listener = (details) => {
        if (details.tabId < 0 || details.type === "main_frame") return;
        const hosts = ZZ.RuleIndex.current().networkHosts;
        if (!hosts.size) return;
        const host = ZZ.hostOf(details.url);
        if (host && hosts.has(host)) Counts.inc(details.tabId, "network", host);
      };
      try {
        wr.onBeforeRequest.addListener(listener, { urls: ["http://*/*", "https://*/*"] });
      } catch (e) {
        ZZ.warn("network counter unavailable", e && e.message);
      }
    },
  };

  ZZ.Counts = Counts;
})();

(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;
  const SIG_KEY = "zz.dnrSig";
  const cssByTab = new Map();
  let ready = null;

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function dnrSignature() {
    const s = ZZ.Store.settings();
    const rules = ZZ.Store.rules().map((r) => r.id + ":" + (r.enabled === false ? 0 : 1));
    const subs = ((s.subscriptions || {}).items || []).map(
      (it) => it.id + ":" + (it.enabled === false ? 0 : 1) + ":" + (it.lastUpdatedAt || 0)
    );
    return hash(
      JSON.stringify({
        enabled: s.enabled,
        network: s.network,
        budget: s.dnrBudget,
        packs: s.packs,
        rules,
        subs,
        version: ZZ.info.version,
      })
    );
  }

  function targetFor(tabId) {
    return { tabId, allFrames: true };
  }

  async function removeCss(tabId, css) {
    if (!css || !api.scripting || !api.scripting.removeCSS) return;
    try {
      await ZZ.call(api.scripting, "removeCSS", { target: targetFor(tabId), css, origin: "user" });
    } catch (e) {
      try {
        await ZZ.call(api.scripting, "removeCSS", { target: targetFor(tabId), css });
      } catch (e2) {}
    }
  }

  async function insertCss(tabId, css) {
    if (!css) return false;
    if (api.scripting && api.scripting.insertCSS) {
      try {
        await ZZ.call(api.scripting, "insertCSS", { target: targetFor(tabId), css, origin: "user" });
        return true;
      } catch (e) {
        try {
          await ZZ.call(api.scripting, "insertCSS", { target: targetFor(tabId), css });
          return true;
        } catch (e2) {
          return false;
        }
      }
    }
    if (api.tabs && api.tabs.insertCSS) {
      try {
        await ZZ.call(api.tabs, "insertCSS", tabId, { code: css, allFrames: true });
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  async function saveSig() {
    const obj = {};
    obj[SIG_KEY] = dnrSignature();
    await ZZ.call(api.storage.local, "set", obj).catch(() => {});
  }

  const Main = {
    async init() {
      if (ready) return ready;
      ready = (async () => {
        await ZZ.Store.load();
        await ZZ.RuleIndex.loadPacks();
        const settings = ZZ.Store.settings();
        ZZ.I18n.setLang(settings.lang || "auto");
        ZZ.RuleIndex.build(ZZ.Store.activeRules(), settings.packs);
        await Main.installMenus();
        const sig = dnrSignature();
        let savedSig = null;
        try {
          const res = await ZZ.call(api.storage.local, "get", SIG_KEY);
          savedSig = res && res[SIG_KEY];
        } catch (e) {}
        if (sig !== savedSig) {
          await ZZ.Dnr.sync();
          await saveSig();
        }
        ZZ.log("ready", ZZ.RuleIndex.stats(), ZZ.Dnr.lastResult);
        if (ZZ.Autopilot && ZZ.Autopilot.schedule) {
          ZZ.Autopilot.schedule().catch(() => {});
        }
        if (ZZ.Subscriptions && ZZ.Subscriptions.schedule) {
          ZZ.Subscriptions.schedule().catch(() => {});
        }
        return true;
      })();
      return ready;
    },

    async installMenus() {
      try {
        await ZZ.Menus.install();
      } catch (e) {}
    },

    async rebuild(opts) {
      await Main.init();
      const settings = ZZ.Store.settings();
      ZZ.RuleIndex.build(ZZ.Store.activeRules(), settings.packs);
      if (opts && opts.dnr) {
        await ZZ.Dnr.sync();
        await saveSig();
      }
      if (opts && opts.refresh) await Main.refreshAllTabs();
      return ZZ.RuleIndex.stats();
    },

    async injectForTab(tabId, url) {
      const host = ZZ.hostOf(url || "");
      const settings = ZZ.Store.settings();
      if (!host || !settings.enabled || !settings.cosmetic || !ZZ.Store.siteEnabled(host)) {
        const old = cssByTab.get(tabId);
        if (old) {
          await removeCss(tabId, old);
          cssByTab.delete(tabId);
        }
        return;
      }
      const payload = ZZ.RuleIndex.payload(host);
      const prev = cssByTab.get(tabId);
      if (prev === payload.css) return;
      if (prev) await removeCss(tabId, prev);
      if (payload.css) {
        const ok = await insertCss(tabId, payload.css);
        if (ok) cssByTab.set(tabId, payload.css);
        else cssByTab.delete(tabId);
      } else {
        cssByTab.delete(tabId);
      }
    },

    forgetTab(tabId) {
      cssByTab.delete(tabId);
    },

    async refreshAllTabs() {
      let tabs = [];
      try {
        tabs = (await ZZ.call(api.tabs, "query", {})) || [];
      } catch (e) {
        return;
      }
      for (const tab of tabs) {
        if (!tab || typeof tab.id !== "number" || !ZZ.isHttpUrl(tab.url || "")) continue;
        await Main.injectForTab(tab.id, tab.url);
        ZZ.call(api.tabs, "sendMessage", tab.id, { type: "zz:rules-updated" }).catch(() => {});
      }
    },

    installListeners() {
      if (api.webNavigation && api.webNavigation.onCommitted) {
        api.webNavigation.onCommitted.addListener((details) => {
          if (!details || details.frameId !== 0) return;
          if (!ZZ.isHttpUrl(details.url)) return;
          Main.forgetTab(details.tabId);
          if (details.tabId >= 0) ZZ.Counts.reset(details.tabId);
          Main.init().then(() => Main.injectForTab(details.tabId, details.url));
        });
      }
      if (api.webNavigation && api.webNavigation.onHistoryStateUpdated) {
        api.webNavigation.onHistoryStateUpdated.addListener((details) => {
          if (!details || details.frameId !== 0) return;
          if (!ZZ.isHttpUrl(details.url)) return;
          Main.init().then(() => {
            Main.injectForTab(details.tabId, details.url);
            ZZ.call(api.tabs, "sendMessage", details.tabId, { type: "zz:rules-updated" }).catch(() => {});
          });
        });
      }
      if (api.tabs && api.tabs.onRemoved) {
        api.tabs.onRemoved.addListener((tabId) => {
          cssByTab.delete(tabId);
          ZZ.Counts.reset(tabId);
          if (ZZ.Scanner && ZZ.Scanner.onTabRemoved) ZZ.Scanner.onTabRemoved(tabId);
        });
      }
      if (api.runtime && api.runtime.onInstalled) {
        api.runtime.onInstalled.addListener((details) => {
          Main.init().then(() => {
            Main.installMenus();
            if (details && details.reason === "install" && api.runtime.openOptionsPage) {
              ZZ.call(api.runtime, "openOptionsPage").catch(() => {});
            }
          });
        });
      }
      if (api.runtime && api.runtime.onStartup) {
        api.runtime.onStartup.addListener(() => {
          Main.init().then(() => Main.rebuild({ dnr: true, refresh: true }));
        });
      }
      if (api.commands && api.commands.onCommand) {
        api.commands.onCommand.addListener(async (command, tab) => {
          await Main.init();
          let target = tab;
          if (!target) {
            const tabs = await ZZ.call(api.tabs, "query", { active: true, currentWindow: true });
            target = tabs && tabs[0];
          }
          if (!target || typeof target.id !== "number") return;
          if (command === "zz-pick") {
            ZZ.sendToTab(target.id, { type: "zz:picker:start" });
          } else if (command === "zz-ai-page") {
            ZZ.Messages.runAiOnTab(target, { source: "command" }).catch(() => {});
          }
        });
      }
    },
  };

  ZZ.Main = Main;

  Main.installListeners();
  ZZ.Menus.listen();
  ZZ.Perms.listen();
  ZZ.Counts.installNetworkCounter();
  if (ZZ.Sniffer) ZZ.Sniffer.install();
  ZZ.Messages.listen();
  Main.init();
})();

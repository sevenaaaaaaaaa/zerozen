(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;

  const MENUS = [
    { id: "zz-block-element", title: "ZeroZen：屏蔽此元素…", contexts: ["page", "frame", "image", "link"] },
    { id: "zz-ai-page", title: "ZeroZen：AI 识别本页烦人广告", contexts: ["page", "frame"] },
    { id: "zz-pick", title: "ZeroZen：选取元素屏蔽", contexts: ["page", "frame", "selection"] },
    { id: "zz-disable-site", title: "ZeroZen：在此站点停用", contexts: ["page", "frame"] },
    { id: "zz-options", title: "ZeroZen：打开净化控制台", contexts: ["page", "frame", "action"] },
  ];

  const Menus = {
    async install() {
      if (!api.contextMenus || !api.contextMenus.create) return false;
      try {
        await ZZ.call(api.contextMenus, "removeAll");
      } catch (e) {}
      for (const item of MENUS) {
        try {
          api.contextMenus.create({
            id: item.id,
            title: item.title,
            contexts: item.contexts.filter((c) => c !== "action"),
          });
        } catch (e) {}
      }
      return true;
    },

    listen() {
      if (!api.contextMenus || !api.contextMenus.onClicked) return;
      api.contextMenus.onClicked.addListener((info, tab) => {
        if (!tab || typeof tab.id !== "number") return;
        const host = ZZ.hostOf(tab.url || "");
        switch (info.menuItemId) {
          case "zz-block-element":
          case "zz-pick":
            ZZ.sendToTab(tab.id, { type: "zz:picker:start" });
            break;
          case "zz-ai-page":
            ZZ.Messages.runAiOnTab(tab, { source: "menu" }).catch(() => {});
            break;
          case "zz-disable-site":
            ZZ.Store.setSite(host, false).then(() => {
              ZZ.Main.refreshAllTabs();
              ZZ.sendToTab(tab.id, { type: "zz:site-disabled", payload: { host } });
            });
            break;
          case "zz-options":
            ZZ.call(api.runtime, "openOptionsPage").catch(() => {});
            break;
        }
      });
    },
  };

  ZZ.Menus = Menus;
})();

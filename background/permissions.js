(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;

  // 这些权限不在安装时申请，用到对应功能时才由控制台/工具箱发起授权
  const OPTIONAL = [
    {
      id: "bookmarks",
      name: "收藏夹",
      why: "批量扫描时读取收藏夹里的网址，只读取地址与文件夹名，不会修改收藏夹。",
      features: ["批量扫描 → 收藏夹来源"],
    },
    {
      id: "history",
      name: "浏览记录",
      why: "「自主增强」按域名聚合最近 30 天的访问次数，挑出常访问站点做规则优化；只在本地统计，不上传。",
      features: ["自主增强"],
    },
    {
      id: "downloads",
      name: "下载",
      why: "把阅读模式的 Markdown、嗅探到的视频、页面图片保存到下载目录下的 ZeroZen/ 子目录，并管理下载任务。",
      features: ["阅读模式保存", "视频嗅探", "图片发现", "下载器"],
    },
    {
      id: "webRequest",
      name: "请求观察",
      why: "只用于统计每个标签页被拦截的请求数，以及嗅探 m3u8/mpd 视频地址；不读取、不存储、不上传请求内容。",
      features: ["拦截计数", "视频嗅探"],
    },
  ];

  let bound = false;

  function supported() {
    return !!(api.permissions && api.permissions.contains);
  }

  const Perms = {
    OPTIONAL,

    async has(id) {
      if (!supported()) return !!api[id];
      try {
        return await ZZ.call(api.permissions, "contains", { permissions: [id] });
      } catch (e) {
        return !!api[id];
      }
    },

    async status() {
      const out = {};
      for (const p of OPTIONAL) out[p.id] = await Perms.has(p.id);
      return {
        supported: supported(),
        granted: out,
        items: OPTIONAL.map((p) => Object.assign({ granted: !!out[p.id] }, p)),
      };
    },

    async remove(id) {
      if (!supported() || !api.permissions.remove) return false;
      try {
        return await ZZ.call(api.permissions, "remove", { permissions: [id] });
      } catch (e) {
        return false;
      }
    },

    // 运行期被授予权限后，重新挂上依赖该权限的监听器
    onGranted(list) {
      const ids = list || [];
      if (ids.indexOf("webRequest") >= 0) {
        if (ZZ.Counts && ZZ.Counts.installNetworkCounter) ZZ.Counts.installNetworkCounter();
        if (ZZ.Sniffer && ZZ.Sniffer.install) ZZ.Sniffer.install();
      }
    },

    listen() {
      if (bound || !api.permissions || !api.permissions.onAdded) return;
      bound = true;
      api.permissions.onAdded.addListener((p) => {
        const ids = (p && p.permissions) || [];
        ZZ.log("permission granted", ids);
        Perms.onGranted(ids);
      });
      if (api.permissions.onRemoved) {
        api.permissions.onRemoved.addListener((p) => {
          ZZ.log("permission removed", (p && p.permissions) || []);
        });
      }
    },
  };

  ZZ.Perms = Perms;
})();

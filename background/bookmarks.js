(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;

  function isSkippableHost(host) {
    if (!host) return true;
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return true;
    if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    if (/^169\.254\./.test(host)) return true;
    return false;
  }

  const Bookmarks = {
    supported() {
      return !!(api.bookmarks && api.bookmarks.getTree);
    },

    async tree() {
      if (!Bookmarks.supported()) return null;
      const nodes = await ZZ.call(api.bookmarks, "getTree");
      return nodes || null;
    },

    buildFolders(nodes) {
      const folders = [];
      function walk(list, path) {
        for (const node of list || []) {
          if (node.url) continue;
          const label = node.title || (node.id === "0" ? "全部书签" : "(未命名)");
          const full = path ? path + " / " + label : label;
          folders.push({ id: node.id, title: label, path: full, count: countUrls(node) });
          if (node.children) walk(node.children, full);
        }
      }
      function countUrls(node) {
        let n = 0;
        for (const c of node.children || []) {
          if (c.url) n++;
          else n += countUrls(c);
        }
        return n;
      }
      walk(nodes || [], "");
      return folders;
    },

    collectUrls(nodes, folderId) {
      const urls = [];
      function walk(list) {
        for (const node of list || []) {
          if (node.url && /^https?:/i.test(node.url)) {
            urls.push({ url: node.url, title: node.title || "", folder: node.parentId || "" });
          }
          if (node.children) walk(node.children);
        }
      }
      if (folderId) {
        const found = findNode(nodes || [], folderId);
        if (found) walk([found]);
      } else {
        walk(nodes || []);
      }
      return urls;
    },

    sites(nodes, folderId) {
      const byHost = new Map();
      const urls = Bookmarks.collectUrls(nodes, folderId);
      for (const item of urls) {
        let host = "";
        try {
          host = new URL(item.url).hostname.toLowerCase();
        } catch (e) {
          continue;
        }
        if (isSkippableHost(host)) continue;
        if (!byHost.has(host)) {
          byHost.set(host, { host, url: item.url, title: item.title, count: 0 });
        }
        byHost.get(host).count++;
      }
      return Array.from(byHost.values()).sort((a, b) => b.count - a.count);
    },

    async preview(folderId) {
      if (!Bookmarks.supported()) {
        return { supported: false, folders: [], sites: [], total: 0 };
      }
      const nodes = await Bookmarks.tree();
      if (!nodes) return { supported: false, folders: [], sites: [], total: 0 };
      const folders = Bookmarks.buildFolders(nodes);
      const sites = Bookmarks.sites(nodes, folderId);
      return { supported: true, folders, sites, total: sites.length };
    },
  };

  function findNode(list, id) {
    for (const node of list || []) {
      if (node.id === id) return node;
      if (node.children) {
        const hit = findNode(node.children, id);
        if (hit) return hit;
      }
    }
    return null;
  }

  Bookmarks.isSkippableHost = isSkippableHost;
  ZZ.Bookmarks = Bookmarks;
})();

(function () {
  const g = globalThis;
  if (g.ZZUI) return;
  const ZZ = (g.ZZ = g.ZZ || {});
  const api = ZZ.browser;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  // 可选权限：用到对应功能时才申请（必须在用户点击等手势里调用）
  function hasPermission(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    if (!api.permissions || !api.permissions.contains) {
      return Promise.resolve(list.every((id) => !!api[id]));
    }
    return new Promise((resolve) => {
      try {
        const ret = api.permissions.contains({ permissions: list }, (ok) => resolve(!!ok));
        if (ret && typeof ret.then === "function") ret.then((ok) => resolve(!!ok)).catch(() => resolve(false));
      } catch (e) {
        resolve(false);
      }
    });
  }

  function requestPermission(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    if (!api.permissions || !api.permissions.request) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        const ret = api.permissions.request({ permissions: list }, (ok) => resolve(!!ok));
        if (ret && typeof ret.then === "function") ret.then((ok) => resolve(!!ok)).catch(() => resolve(false));
      } catch (e) {
        resolve(false);
      }
    });
  }

  g.ZZUI = {
    $,
    $$,
    hasPermission,
    requestPermission,
    async ensurePermission(ids) {
      const list = Array.isArray(ids) ? ids : [ids];
      if (await hasPermission(list)) return true;
      const ok = await requestPermission(list);
      if (ok) {
        try {
          await api.runtime.sendMessage({ type: "zz:perms:granted", payload: { permissions: list } });
        } catch (e) {}
      }
      return ok;
    },
    send(message) {
      return new Promise((resolve) => {
        let settled = false;
        const done = (res) => {
          if (settled) return;
          settled = true;
          resolve(res);
        };
        const timer = setTimeout(() => {
          done({ ok: false, error: "扩展后台无响应，请到浏览器扩展页重载 ZeroZen" });
        }, 10000);
        try {
          const ret = api.runtime.sendMessage(message);
          if (ret && typeof ret.then === "function") {
            ret
              .then((res) => {
                clearTimeout(timer);
                done(res || { ok: true });
              })
              .catch((e) => {
                clearTimeout(timer);
                done({ ok: false, error: e && e.message ? e.message : String(e) });
              });
            return;
          }
        } catch (e) {
          clearTimeout(timer);
          done({ ok: false, error: e && e.message ? e.message : String(e) });
          return;
        }
        clearTimeout(timer);
        done({ ok: false, error: "no response" });
      });
    },
    openOptions() {
      return new Promise((resolve) => {
        try {
          const ret = api.runtime.openOptionsPage();
          if (ret && typeof ret.then === "function") {
            ret.then(() => resolve(true)).catch(() => resolve(false));
            return;
          }
          resolve(true);
        } catch (e) {
          try {
            api.tabs.create({ url: api.runtime.getURL("ui/options.html") });
            resolve(true);
          } catch (e2) {
            resolve(false);
          }
        }
      });
    },
    openToolbox(tabId) {
      const url = api.runtime.getURL("ui/toolbox.html") + (tabId ? "?tab=" + tabId : "");
      return new Promise((resolve) => {
        try {
          const ret = api.tabs.create({ url });
          if (ret && typeof ret.then === "function") {
            ret.then(() => resolve(true)).catch(() => resolve(false));
            return;
          }
          resolve(true);
        } catch (e) {
          resolve(false);
        }
      });
    },
    async currentTab() {
      try {
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        return (tabs && tabs[0]) || null;
      } catch (e) {
        return null;
      }
    },
    toast(el, text, kind) {
      if (!el) return;
      el.textContent = text;
      el.className = "zz-toast-inline" + (kind ? " " + kind : "");
      el.hidden = false;
      clearTimeout(el._zzTimer);
      el._zzTimer = setTimeout(() => {
        el.hidden = true;
      }, 4200);
    },
    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        return false;
      }
    },
    download(filename, text) {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
    pickFile(accept) {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept || ".json,.txt";
        let settled = false;
        const done = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        input.onchange = () => {
          const file = input.files && input.files[0];
          if (!file) {
            done(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => done({ name: file.name, text: String(reader.result || "") });
          reader.onerror = () => done(null);
          reader.readAsText(file);
        };
        input.oncancel = () => done(null);
        input.click();
      });
    },
    fmtTime(ts) {
      if (!ts) return "—";
      const d = new Date(ts);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    categoryLabel(cat) {
      return (
        {
          banner: "横幅广告",
          "search-ad": "搜索广告",
          native: "原生广告",
          popup: "弹窗",
          interstitial: "插屏",
          video: "视频广告",
          "fake-download": "假下载按钮",
          annoyance: "骚扰弹窗",
          tracking: "追踪",
          other: "其他",
        }[cat] || cat || "其他"
      );
    },
    kindLabel(rule) {
      if (rule.kind === "network") return rule.action === "allow" ? "网络放行" : "网络拦截";
      if (rule.kind === "text") return "文案屏蔽";
      if (rule.action === "allow") return "外观放行";
      if (rule.action === "remove") return "元素移除";
      return "元素隐藏";
    },
    sourceLabel(source) {
      return (
        {
          builtin: "内置",
          user: "自定义",
          ai: "AI",
          scan: "扫描",
          import: "导入",
        }[source] || source || "其他"
      );
    },
  };
})();

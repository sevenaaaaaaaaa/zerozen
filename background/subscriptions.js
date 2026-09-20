(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;
  const F = ZZ.RuleFormat;

  const ALARM = "zz.subs.update";
  const MAX_BYTES = 8 * 1024 * 1024;
  const MIN_INTERVAL_HOURS = 6;
  const MAX_INTERVAL_HOURS = 24 * 30;
  const DEFAULT_MAX_RULES = 15000;
  const HARD_MAX_RULES = 60000;

  // 预设订阅源：url 失败时自动回退 mirror
  const PRESETS = [
    {
      id: "easylist",
      name: "EasyList",
      desc: "国际通用广告过滤列表（基础款）",
      license: "GPLv3 / CC BY-SA 3.0",
      url: "https://easylist.to/easylist/easylist.txt",
      mirror: "https://cdn.jsdelivr.net/gh/easylist/easylist@latest/easylist.txt",
    },
    {
      id: "easyprivacy",
      name: "EasyPrivacy",
      desc: "追踪与统计脚本拦截",
      license: "GPLv3 / CC BY-SA 3.0",
      url: "https://easylist.to/easylist/easyprivacy.txt",
      mirror: "https://easylist-downloads.adblockplus.org/easyprivacy.txt",
    },
    {
      id: "easylist-china",
      name: "EasyList China",
      desc: "中文站点广告补充",
      license: "GPLv3 / CC BY-SA 3.0",
      url: "https://easylist-downloads.adblockplus.org/easylistchina.txt",
      mirror: "https://cdn.jsdelivr.net/gh/easylist/easylistchina@master/easylistchina.txt",
    },
    {
      id: "anti-ad",
      name: "anti-AD",
      desc: "国内维护的纯域名拦截列表，命中率高",
      license: "GPLv3",
      url: "https://anti-ad.net/easylist.txt",
      mirror: "https://cdn.jsdelivr.net/gh/privacy-protection-tools/anti-AD@master/easylist.txt",
    },
    {
      id: "cjx-annoyance",
      name: "CJX's Annoyance List",
      desc: "中文站点烦扰元素（登录墙、App 引导、浮层）",
      license: "GPLv3",
      url: "https://cdn.jsdelivr.net/gh/cjx82630/cjxlist@master/cjx-annoyance.txt",
      mirror: "https://raw.githubusercontent.com/cjx82630/cjxlist/master/cjx-annoyance.txt",
    },
    {
      id: "adguard-cn",
      name: "AdGuard Chinese filter",
      desc: "AdGuard 中文过滤器",
      license: "GPLv3",
      url: "https://filters.adtidy.org/extension/ublock/filters/224.txt",
      mirror: "",
    },
    {
      id: "adguard-base",
      name: "AdGuard Base filter",
      desc: "AdGuard 国际基础过滤器（体量大）",
      license: "GPLv3",
      url: "https://filters.adtidy.org/extension/ublock/filters/2.txt",
      mirror: "",
    },
    {
      id: "ublock-filters",
      name: "uBlock Origin filters",
      desc: "uAssets 官方补充规则",
      license: "GPLv3",
      url: "https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssets@master/filters/filters.txt",
      mirror: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt",
    },
    {
      id: "peter-lowe",
      name: "Peter Lowe's list",
      desc: "广告与追踪服务器域名列表",
      license: "免费个人使用（见 pgl.yoyo.org）",
      url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0",
      mirror: "",
    },
    {
      id: "1hosts-lite",
      name: "1Hosts (Lite)",
      desc: "纯域名拦截，误杀率低",
      license: "MPL-2.0",
      url: "https://cdn.jsdelivr.net/gh/badmojr/1Hosts@master/Lite/adblock.txt",
      mirror: "https://raw.githubusercontent.com/badmojr/1Hosts/master/Lite/adblock.txt",
    },
  ];

  let alarmBound = false;
  let updating = false;

  function cfg() {
    const s = ZZ.Store.settings();
    const c = s.subscriptions || {};
    return {
      enabled: c.enabled !== false,
      intervalHours: clampInterval(c.intervalHours),
      maxRules: clampMaxRules(c.maxRules),
      timeoutMs: Math.max(5000, Math.min(120000, Number(c.timeoutMs) || 30000)),
      lastCheckAt: Number(c.lastCheckAt) || 0,
      items: Array.isArray(c.items) ? c.items : [],
    };
  }

  function clampInterval(v) {
    const n = Number(v);
    if (!n || !isFinite(n)) return 72;
    return Math.max(MIN_INTERVAL_HOURS, Math.min(MAX_INTERVAL_HOURS, Math.round(n)));
  }

  function clampMaxRules(v) {
    const n = Number(v);
    if (!n || !isFinite(n)) return DEFAULT_MAX_RULES;
    return Math.max(500, Math.min(HARD_MAX_RULES, Math.round(n)));
  }

  async function saveItems(items, extra) {
    const patch = Object.assign({ items: items }, extra || {});
    await ZZ.Store.saveSettings({ subscriptions: patch });
    return cfg().items;
  }

  function findItem(items, id) {
    return (items || []).find((it) => it && it.id === id) || null;
  }

  function normalizeUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return null;
    let u;
    try {
      u = new URL(raw);
    } catch (e) {
      return null;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href;
  }

  // hosts 文件 / 纯域名列表 → Adblock 语法，其他行原样保留
  function preprocess(text) {
    const out = [];
    const lines = String(text || "").split(/\r?\n/);
    for (const line of lines) {
      const l = line.trim();
      if (!l) continue;
      if (l.startsWith("!") || l.startsWith("[")) {
        out.push(l);
        continue;
      }
      if (l.startsWith("#")) {
        // "##.ad" / "#@#.ad" 是外观规则，"# comment" 是 hosts 注释
        if (l.startsWith("##") || l.startsWith("#@#") || l.startsWith("#?#")) out.push(l);
        continue;
      }
      const hosts = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1|::)[ \t]+([^\s#]+)/.exec(l);
      if (hosts) {
        const h = hosts[1].toLowerCase().replace(/\.$/, "");
        if (h && h.indexOf(".") > 0 && !/^localhost/.test(h) && h !== "broadcasthost") {
          out.push("||" + h + "^");
        }
        continue;
      }
      if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(l)) {
        out.push("||" + l.toLowerCase() + "^");
        continue;
      }
      out.push(l);
    }
    return out.join("\n");
  }

  function metaOf(text) {
    const head = String(text || "").slice(0, 4000);
    const title = /^!\s*Title:\s*(.+)$/im.exec(head);
    const version = /^!\s*Version:\s*(.+)$/im.exec(head);
    const expires = /^!\s*Expires:\s*(\d+)\s*(day|hour)/im.exec(head);
    let expiresHours = 0;
    if (expires) {
      const n = Number(expires[1]) || 0;
      expiresHours = /hour/i.test(expires[2]) ? n : n * 24;
    }
    return {
      title: title ? title[1].trim().slice(0, 80) : "",
      version: version ? version[1].trim().slice(0, 40) : "",
      expiresHours,
    };
  }

  // 按上限截断：先给外观规则留位置，网络规则受 DNR 预算约束，留太多也用不上
  function capRules(network, cosmetic, max) {
    const netCap = Math.floor(max * 0.6);
    const out = [];
    for (const r of network.slice(0, netCap)) out.push(r);
    for (const r of cosmetic) {
      if (out.length >= max) break;
      out.push(r);
    }
    for (let i = netCap; i < network.length && out.length < max; i++) out.push(network[i]);
    return out;
  }

  function parseText(text, subId, max) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return { error: "列表内容为空" };
    let network = [];
    let cosmetic = [];
    let skipped = 0;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const native = F.parseNative(text);
      if (native.error) return { error: native.error };
      for (const r of native.rules || []) {
        if (r.kind === "network") network.push(r);
        else cosmetic.push(r);
      }
      skipped = (native.skipped || []).length;
    } else {
      const parsed = F.parseAdblockText(preprocess(text), { source: "sub" });
      network = parsed.network || [];
      cosmetic = parsed.cosmetic || [];
      skipped = (parsed.skipped || []).length;
    }
    const total = network.length + cosmetic.length;
    if (!total) return { error: "没有解析出任何可用规则" };
    const limit = clampMaxRules(max);
    const picked = capRules(network, cosmetic, limit);
    const seen = new Set();
    const rules = [];
    for (const r of picked) {
      const key = F.canonicalKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push(
        Object.assign({}, r, {
          id: "s:" + subId + ":" + rules.length,
          source: "sub",
          sub: subId,
          enabled: true,
        })
      );
    }
    return {
      rules,
      parsed: total,
      skipped,
      truncated: total > picked.length,
      network: rules.filter((r) => r.kind === "network").length,
      cosmetic: rules.filter((r) => r.kind !== "network").length,
    };
  }

  async function fetchOnce(url, item, opts) {
    const headers = { Accept: "text/plain,*/*" };
    if (!(opts && opts.force)) {
      if (item && item.etag) headers["If-None-Match"] = item.etag;
      else if (item && item.lastModified) headers["If-Modified-Since"] = item.lastModified;
    }
    const timeoutMs = (opts && opts.timeoutMs) || cfg().timeoutMs;
    let ctrl = null;
    let timer = null;
    if (typeof AbortController !== "undefined") {
      ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), timeoutMs);
    }
    let res;
    try {
      res = await fetch(url, {
        headers,
        redirect: "follow",
        cache: "no-cache",
        credentials: "omit",
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      const msg = e && e.name === "AbortError" ? "请求超时" : (e && e.message) || "网络错误";
      throw new Error(msg);
    }
    if (timer) clearTimeout(timer);
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new Error("HTTP " + res.status);
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_BYTES) throw new Error("列表过大（>8MB）");
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("列表过大（>8MB）");
    return {
      text,
      etag: res.headers.get("etag") || "",
      lastModified: res.headers.get("last-modified") || "",
      bytes: text.length,
    };
  }

  async function download(item, opts) {
    const urls = [item.url];
    if (item.mirror) urls.push(item.mirror);
    let lastError = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const res = await fetchOnce(urls[i], item, opts);
        res.usedMirror = i > 0;
        return res;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error("下载失败");
  }

  const Subscriptions = {
    PRESETS,
    ALARM,

    config() {
      const c = cfg();
      return {
        enabled: c.enabled,
        intervalHours: c.intervalHours,
        maxRules: c.maxRules,
        timeoutMs: c.timeoutMs,
        lastCheckAt: c.lastCheckAt,
      };
    },

    list() {
      const c = cfg();
      const store = ZZ.Store.subs();
      return c.items.map((it) => {
        const entry = store[it.id] || null;
        return Object.assign({}, it, {
          ruleCount: entry ? (entry.rules || []).length : 0,
          storedAt: entry ? entry.at || 0 : 0,
        });
      });
    },

    stats() {
      const items = Subscriptions.list();
      const enabled = items.filter((it) => it.enabled !== false);
      return {
        total: items.length,
        enabled: enabled.length,
        rules: enabled.reduce((n, it) => n + (it.ruleCount || 0), 0),
        lastCheckAt: cfg().lastCheckAt,
      };
    },

    async setConfig(patch) {
      const p = patch || {};
      const next = {};
      if (p.enabled !== undefined) next.enabled = p.enabled !== false;
      if (p.intervalHours !== undefined) next.intervalHours = clampInterval(p.intervalHours);
      if (p.maxRules !== undefined) next.maxRules = clampMaxRules(p.maxRules);
      if (p.timeoutMs !== undefined) next.timeoutMs = Math.max(5000, Math.min(120000, Number(p.timeoutMs) || 30000));
      await ZZ.Store.saveSettings({ subscriptions: next });
      await Subscriptions.installAlarm();
      return Subscriptions.config();
    },

    async add(input) {
      const p = input || {};
      const url = normalizeUrl(p.url);
      if (!url) return { ok: false, error: "订阅地址必须是 http(s) 链接" };
      const c = cfg();
      if (c.items.length >= 30) return { ok: false, error: "订阅数量已达上限（30）" };
      if (c.items.some((it) => it.url === url)) return { ok: false, error: "该订阅已存在" };
      const preset = PRESETS.find((x) => x.url === url || x.id === p.presetId) || null;
      const item = {
        id: ZZ.uid("sub"),
        name: String(p.name || (preset && preset.name) || "").trim().slice(0, 60) || url.replace(/^https?:\/\//, "").slice(0, 48),
        url,
        mirror: (preset && preset.mirror) || "",
        preset: preset ? preset.id : "",
        license: (preset && preset.license) || "",
        enabled: p.enabled !== false,
        addedAt: Date.now(),
        lastUpdatedAt: 0,
        lastStatus: "",
        error: "",
        etag: "",
        lastModified: "",
      };
      await saveItems(c.items.concat([item]));
      const res = await Subscriptions.update(item.id, { force: true, rebuild: true });
      return { ok: true, item: findItem(cfg().items, item.id), result: res };
    },

    async remove(id) {
      const c = cfg();
      if (!findItem(c.items, id)) return { ok: false, error: "订阅不存在" };
      await saveItems(c.items.filter((it) => it.id !== id));
      await ZZ.Store.dropSubRules(id);
      await ZZ.Main.rebuild({ dnr: true, refresh: true });
      return { ok: true };
    },

    async setEnabled(id, enabled) {
      const c = cfg();
      const items = c.items.map((it) => (it.id === id ? Object.assign({}, it, { enabled: enabled !== false }) : it));
      if (!findItem(items, id)) return { ok: false, error: "订阅不存在" };
      await saveItems(items);
      await ZZ.Main.rebuild({ dnr: true, refresh: true });
      return { ok: true, enabled: enabled !== false };
    },

    async update(id, opts) {
      const o = opts || {};
      const c = cfg();
      const item = findItem(c.items, id);
      if (!item) return { ok: false, error: "订阅不存在" };
      let patch;
      let out;
      try {
        const res = await download(item, { force: o.force, timeoutMs: c.timeoutMs });
        if (res.notModified) {
          patch = { lastStatus: "not-modified", lastCheckedAt: Date.now(), error: "" };
          out = { ok: true, notModified: true, ruleCount: (ZZ.Store.subs()[id] || { rules: [] }).rules.length };
        } else {
          const meta = metaOf(res.text);
          const parsed = parseText(res.text, id, c.maxRules);
          if (parsed.error) throw new Error(parsed.error);
          await ZZ.Store.setSubRules(id, parsed.rules);
          patch = {
            lastStatus: "ok",
            lastUpdatedAt: Date.now(),
            lastCheckedAt: Date.now(),
            error: "",
            etag: res.etag || "",
            lastModified: res.lastModified || "",
            bytes: res.bytes || 0,
            usedMirror: !!res.usedMirror,
            listTitle: meta.title,
            listVersion: meta.version,
            expiresHours: meta.expiresHours,
            ruleCount: parsed.rules.length,
            networkCount: parsed.network,
            cosmeticCount: parsed.cosmetic,
            parsedCount: parsed.parsed,
            truncated: !!parsed.truncated,
          };
          out = {
            ok: true,
            added: parsed.rules.length,
            parsed: parsed.parsed,
            skipped: parsed.skipped,
            truncated: !!parsed.truncated,
            usedMirror: !!res.usedMirror,
          };
        }
      } catch (e) {
        patch = { lastStatus: "error", lastCheckedAt: Date.now(), error: (e && e.message) || "更新失败" };
        out = { ok: false, error: patch.error };
      }
      const items = cfg().items.map((it) => (it.id === id ? Object.assign({}, it, patch) : it));
      await saveItems(items);
      if (out.ok && !out.notModified && o.rebuild !== false) {
        await ZZ.Main.rebuild({ dnr: true, refresh: true });
      }
      return out;
    },

    async updateAll(opts) {
      const o = opts || {};
      if (updating) return { ok: false, error: "正在更新中" };
      updating = true;
      const summary = { ok: true, updated: 0, notModified: 0, failed: 0, details: [] };
      try {
        const items = cfg().items.filter((it) => it && (o.includeDisabled || it.enabled !== false));
        for (const item of items) {
          if (!o.force && !Subscriptions.isStale(item)) {
            summary.notModified++;
            summary.details.push({ id: item.id, name: item.name, skipped: true });
            continue;
          }
          const res = await Subscriptions.update(item.id, { force: o.force, rebuild: false });
          if (!res.ok) summary.failed++;
          else if (res.notModified) summary.notModified++;
          else summary.updated++;
          summary.details.push(Object.assign({ id: item.id, name: item.name }, res));
          await ZZ.sleep(300);
        }
        await ZZ.Store.saveSettings({ subscriptions: { lastCheckAt: Date.now() } });
        if (summary.updated) await ZZ.Main.rebuild({ dnr: true, refresh: true });
      } finally {
        updating = false;
      }
      return summary;
    },

    isStale(item) {
      const c = cfg();
      const hours = item && item.expiresHours ? Math.max(c.intervalHours, item.expiresHours) : c.intervalHours;
      const last = (item && (item.lastCheckedAt || item.lastUpdatedAt)) || 0;
      return Date.now() - last >= hours * 3600 * 1000;
    },

    async maybeAutoUpdate(force) {
      const c = cfg();
      if (!c.enabled || !c.items.length) return { ok: true, skipped: true };
      if (!force && Date.now() - c.lastCheckAt < Math.min(c.intervalHours, 12) * 3600 * 1000) {
        return { ok: true, skipped: true };
      }
      return Subscriptions.updateAll({ force: false });
    },

    async installAlarm() {
      if (!api.alarms || !api.alarms.create) return false;
      const c = cfg();
      if (!alarmBound && api.alarms.onAlarm) {
        alarmBound = true;
        api.alarms.onAlarm.addListener((alarm) => {
          if (!alarm || alarm.name !== ALARM) return;
          ZZ.Main.init()
            .then(() => Subscriptions.maybeAutoUpdate(true))
            .catch((e) => ZZ.warn("subscription auto update failed", e && e.message));
        });
      }
      try {
        if (!c.enabled) {
          await ZZ.call(api.alarms, "clear", ALARM);
          return false;
        }
        await ZZ.call(api.alarms, "create", ALARM, {
          periodInMinutes: c.intervalHours * 60,
          delayInMinutes: 5,
        });
        return true;
      } catch (e) {
        ZZ.warn("alarm install failed", e && e.message);
        return false;
      }
    },

    async schedule() {
      await Subscriptions.installAlarm();
      if (api.alarms && api.alarms.create) return;
      // 没有 alarms 接口（例如部分 Safari 版本）时退化为启动后延迟检查
      setTimeout(() => {
        Subscriptions.maybeAutoUpdate(false).catch(() => {});
      }, 30000);
    },
  };

  // 供 scripts/selftest.mjs 使用的内部函数
  Subscriptions.__test = { preprocess, parseText, capRules, normalizeUrl, metaOf, clampInterval, clampMaxRules };

  ZZ.Subscriptions = Subscriptions;
})();

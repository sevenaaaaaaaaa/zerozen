(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;
  const KEYS = {
    settings: "zz.settings",
    rules: "zz.rules",
    findings: "zz.findings",
    stats: "zz.stats",
    scanCache: "zz.scanCache",
    aiCache: "zz.aiCache",
    learn: "zz.learn",
    subs: "zz.subs",
  };
  const SCHEMA = 1;

  const DEFAULT_SETTINGS = {
    schema: SCHEMA,
    enabled: true,
    cosmetic: true,
    flowFix: true,
    network: true,
    popupGuard: true,
    youtubeAuto: true,
    countMatches: true,
    badge: true,
    profile: "standard",
    lang: "auto",
    autoFallback: true,
    tempMinutes: 30,
    dnrBudget: 4500,
    packs: {
      core: true,
      adnetworks: true,
      annoyances: true,
      longtail: true,
      oss: true,
      search: true,
      "social-cn": true,
      "intl-social": true,
      forum: true,
      youtube: true,
      "video-cn": true,
      live: true,
      news: true,
      "tech-cn": true,
      shopping: true,
      zhihu: true,
      reddit: true,
      linkedin: true,
      warez: true,
      adult: true,
      jp: true,
      kr: true,
      ru: true,
      eu: true,
      sea: true,
      in: true,
      latam: true,
      hktw: true,
      music: true,
      gaming: true,
      sports: true,
      finance: true,
      travel: true,
      edu: true,
      tools: true,
    },
    sites: {},
    ai: {
      enabled: false,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o-mini",
      timeoutMs: 30000,
      maxCandidates: 30,
      minConfidence: 0.75,
      autoApply: false,
      sendText: true,
      sendAttrs: true,
      budgetPerScan: 20,
      reasonLang: "zh",
      customPrompt: "",
    },
    scanning: {
      mode: "fast",
      concurrency: 1,
      delayMs: 800,
      pageTimeoutMs: 20000,
      maxSites: 300,
      aiReview: true,
      skipScanned: true,
      includeSubdomains: false,
    },
    learning: {
      autoApply: true,
      minSites: 2,
    },
    autonomous: {
      enabled: false,
      minVisits: 3,
      maxSites: 15,
      autoApply: true,
      threshold: 0.75,
      skipScanned: true,
      weekly: true,
      lastRunAt: 0,
    },
    honest: {
      url: "",
    },
    subscriptions: {
      enabled: true,
      intervalHours: 72,
      maxRules: 15000,
      timeoutMs: 30000,
      lastCheckAt: 0,
      items: [],
    },
    toolbox: {
      videoDir: ZZ.T("ZeroZen/视频"),
      imageDir: ZZ.T("ZeroZen/图片"),
      articleDir: ZZ.T("ZeroZen/阅读"),
      downloadDir: ZZ.T("ZeroZen/下载"),
      concurrency: 4,
      tsAsMp4: false,
    },
    ui: { ruleFilter: "", tab: "rules" },
  };

  const MAX_FINDINGS = 800;
  const MAX_CACHE = 1200;

  function deepMerge(base, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch === undefined ? base : patch;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v && typeof v === "object" && !Array.isArray(v)) out[k] = deepMerge(base && base[k], v);
      else out[k] = v;
    }
    return out;
  }

  const cache = {
    settings: null,
    rules: null,
    findings: null,
    stats: null,
    scanCache: null,
    aiCache: null,
    subs: null,
    loaded: null,
  };

  let persistTimer = null;
  const dirty = new Set();

  function read(key, fallback) {
    return ZZ.call(api.storage.local, "get", key).then((res) => {
      const v = res && res[key];
      return v === undefined || v === null ? fallback : v;
    });
  }

  function write(key, value) {
    const obj = {};
    obj[key] = value;
    return ZZ.call(api.storage.local, "set", obj);
  }

  const Store = {
    KEYS,
    DEFAULT_SETTINGS,

    async load() {
      if (cache.loaded) return cache.loaded;
      cache.loaded = (async () => {
        const res = (await ZZ.call(api.storage.local, "get", Object.values(KEYS))) || {};
        cache.settings = deepMerge(
          JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
          res[KEYS.settings] || {}
        );
        if (cache.settings.schema !== SCHEMA) cache.settings.schema = SCHEMA;
        cache.rules = Array.isArray(res[KEYS.rules]) ? res[KEYS.rules] : [];
        cache.findings = Array.isArray(res[KEYS.findings]) ? res[KEYS.findings] : [];
        cache.stats = res[KEYS.stats] && typeof res[KEYS.stats] === "object" ? res[KEYS.stats] : {};
        cache.scanCache =
          res[KEYS.scanCache] && typeof res[KEYS.scanCache] === "object" ? res[KEYS.scanCache] : {};
        cache.aiCache =
          res[KEYS.aiCache] && typeof res[KEYS.aiCache] === "object" ? res[KEYS.aiCache] : {};
        cache.subs = res[KEYS.subs] && typeof res[KEYS.subs] === "object" ? res[KEYS.subs] : {};
        return cache;
      })();
      return cache.loaded;
    },

    settings() {
      return cache.settings || DEFAULT_SETTINGS;
    },

    async saveSettings(patch) {
      cache.settings = deepMerge(cache.settings || DEFAULT_SETTINGS, patch || {});
      await write(KEYS.settings, cache.settings);
      return cache.settings;
    },

    rules() {
      return cache.rules || [];
    },

    async saveRules(rules) {
      cache.rules = Array.isArray(rules) ? rules : [];
      await write(KEYS.rules, cache.rules);
      return cache.rules;
    },

    async addRules(list) {
      const existing = new Map((cache.rules || []).map((r) => [r.id, r]));
      for (const r of list || []) {
        if (!r || !r.id) continue;
        existing.set(r.id, r);
      }
      return Store.saveRules(Array.from(existing.values()));
    },

    async updateRule(id, patch) {
      const rules = (cache.rules || []).slice();
      const i = rules.findIndex((r) => r.id === id);
      if (i < 0) return null;
      rules[i] = Object.assign({}, rules[i], patch);
      await Store.saveRules(rules);
      return rules[i];
    },

    async removeRules(ids) {
      const set = new Set(ids || []);
      return Store.saveRules((cache.rules || []).filter((r) => !set.has(r.id)));
    },

    subs() {
      return cache.subs || {};
    },

    async setSubRules(id, rules) {
      if (!id) return null;
      const map = Object.assign({}, cache.subs || {});
      map[id] = { at: Date.now(), rules: Array.isArray(rules) ? rules : [] };
      cache.subs = map;
      await write(KEYS.subs, map);
      return map[id];
    },

    async dropSubRules(id) {
      const map = Object.assign({}, cache.subs || {});
      if (!(id in map)) return false;
      delete map[id];
      cache.subs = map;
      await write(KEYS.subs, map);
      return true;
    },

    subRules() {
      const items = (Store.settings().subscriptions || {}).items || [];
      const map = cache.subs || {};
      const out = [];
      for (const it of items) {
        if (!it || it.enabled === false) continue;
        const entry = map[it.id];
        if (!entry || !Array.isArray(entry.rules)) continue;
        for (const r of entry.rules) out.push(r);
      }
      return out;
    },

    // 参与规则编译的全部规则：自定义规则 + 已启用订阅规则
    activeRules() {
      const user = Store.rules();
      const subs = Store.subRules();
      return subs.length ? user.concat(subs) : user;
    },

    findings() {
      return cache.findings || [];
    },

    async saveFindings(list) {
      cache.findings = (Array.isArray(list) ? list : []).slice(-MAX_FINDINGS);
      await write(KEYS.findings, cache.findings);
      return cache.findings;
    },

    async addFindings(list) {
      const existing = Store.findings().slice();
      const seen = new Set(existing.map((f) => f.fingerprint));
      for (const f of list || []) {
        if (!f || !f.fingerprint || seen.has(f.fingerprint)) continue;
        seen.add(f.fingerprint);
        existing.push(f);
      }
      return Store.saveFindings(existing);
    },

    async updateFinding(id, patch) {
      const list = Store.findings().slice();
      const i = list.findIndex((f) => f.id === id);
      if (i < 0) return null;
      list[i] = Object.assign({}, list[i], patch);
      await Store.saveFindings(list);
      return list[i];
    },

    async removeFindings(ids) {
      const set = new Set(ids || []);
      return Store.saveFindings(Store.findings().filter((f) => !set.has(f.id)));
    },

    stats() {
      return cache.stats || {};
    },

    bumpStat(host, patch) {
      if (!host) return;
      const stats = cache.stats || (cache.stats = {});
      const cur = stats[host] || { hidden: 0, network: 0, popups: 0, texts: 0, removed: 0 };
      const next = Object.assign({}, cur);
      for (const k of Object.keys(patch || {})) {
        const v = patch[k];
        if (k === "lastSeen") next[k] = v;
        else if (typeof v === "number" && typeof next[k] === "number") next[k] = next[k] + v;
        else next[k] = v;
      }
      stats[host] = next;
      Store.schedulePersist("stats");
    },

    async saveStats() {
      await write(KEYS.stats, cache.stats || {});
    },

    async resetStats() {
      cache.stats = {};
      await write(KEYS.stats, {});
      cache.scanCache = {};
      await write(KEYS.scanCache, {});
    },

    scanCache() {
      return cache.scanCache || {};
    },

    async setScanCache(map) {
      cache.scanCache = map || {};
      await write(KEYS.scanCache, cache.scanCache);
    },

    async setScanCacheEntry(host, info) {
      if (!host) return;
      const map = Object.assign({}, cache.scanCache || {});
      map[host] = Object.assign({ mode: "fast" }, map[host], info, { at: Date.now() });
      return Store.setScanCache(map);
    },

    aiCache() {
      return cache.aiCache || {};
    },

    async setAiCache(map) {
      cache.aiCache = map || {};
      await write(KEYS.aiCache, cache.aiCache);
    },

    async cacheAiResult(key, value) {
      const map = cache.aiCache || (cache.aiCache = {});
      map[key] = { at: Date.now(), value };
      const keys = Object.keys(map);
      if (keys.length > MAX_CACHE) {
        keys
          .sort((a, b) => (map[a].at || 0) - (map[b].at || 0))
          .slice(0, keys.length - MAX_CACHE)
          .forEach((k) => delete map[k]);
      }
      Store.schedulePersist("aiCache");
      return value;
    },

    schedulePersist(which) {
      dirty.add(which);
      if (persistTimer) return;
      persistTimer = setTimeout(async () => {
        persistTimer = null;
        const todo = Array.from(dirty);
        dirty.clear();
        for (const key of todo) {
          if (key === "stats") await Store.saveStats();
          else if (key === "aiCache") await write(KEYS.aiCache, cache.aiCache || {});
        }
      }, 1500);
    },

    siteEnabled(host) {
      const s = Store.settings();
      if (!s.enabled) return false;
      const site = s.sites && s.sites[host];
      if (!site) return true;
      if (site.enabled === false) return false;
      if (site.until && site.until > Date.now()) return false;
      if (site.profile === "off") return false;
      return true;
    },

    siteInfo(host) {
      const sites = Store.settings().sites || {};
      return sites[host] || null;
    },

    profileFor(host) {
      const s = Store.settings();
      if (!s.enabled) return { profile: "off", source: "global-disabled", until: 0 };
      const site = (s.sites || {})[host] || null;
      const now = Date.now();
      if (site) {
        if (site.until && site.until > now) {
          return { profile: "off", source: "temporary", until: site.until };
        }
        if (site.enabled === false && site.profile !== "compat" && site.profile !== "standard" && site.profile !== "strict") {
          return { profile: "off", source: "site-disabled", until: 0 };
        }
        if (site.profile && ZZ.Profiles && ZZ.Profiles.IDS.indexOf(site.profile) >= 0) {
          return {
            profile: site.profile,
            source: site.autoCompat ? "auto" : "site",
            until: 0,
            autoCompat: site.autoCompat || null,
          };
        }
        if (site.autoCompat && s.autoFallback && now - (site.autoCompat.at || 0) < 7 * 24 * 3600 * 1000) {
          return { profile: "compat", source: "auto", until: 0, autoCompat: site.autoCompat };
        }
      }
      const global = s.profile && ZZ.Profiles && ZZ.Profiles.IDS.indexOf(s.profile) >= 0 ? s.profile : "standard";
      return { profile: global, source: "global", until: 0 };
    },

    async updateSite(host, patch) {
      if (!host) return null;
      const sites = Object.assign({}, (Store.settings().sites || {}));
      const cur = Object.assign({}, sites[host] || {});
      const p = patch || {};
      if (p.enabled !== undefined) {
        if (p.enabled === true) delete cur.enabled;
        else cur.enabled = false;
      }
      if (p.profile !== undefined) {
        if (p.profile === null || p.profile === "default") delete cur.profile;
        else cur.profile = p.profile;
      }
      if (p.until !== undefined) {
        if (!p.until) delete cur.until;
        else cur.until = p.until;
      }
      if (p.autoCompat !== undefined) {
        if (!p.autoCompat) delete cur.autoCompat;
        else cur.autoCompat = p.autoCompat;
      }
      if (p.clearAuto) {
        delete cur.autoCompat;
        delete cur.until;
        if (cur.profile === "compat") delete cur.profile;
      }
      if (p.clear) {
        delete sites[host];
      } else if (Object.keys(cur).length) {
        cur.at = Date.now();
        sites[host] = cur;
      } else {
        delete sites[host];
      }
      await Store.setSites(sites);
      return sites[host] || null;
    },

    async setSites(map) {
      const settings = Object.assign({}, Store.settings(), { sites: map || {} });
      cache.settings = settings;
      await write(KEYS.settings, settings);
      return settings.sites;
    },

    async setSite(host, enabled) {
      const res = await Store.updateSite(host, { enabled: enabled !== false });
      return res ? res.enabled !== false : true;
    },

    packEnabled(id) {
      const packs = Store.settings().packs || {};
      return packs[id] !== false;
    },

    async setPack(id, enabled) {
      const packs = Object.assign({}, Store.settings().packs || {});
      packs[id] = !!enabled;
      await Store.saveSettings({ packs });
      return packs;
    },
  };

  ZZ.Store = Store;
})();

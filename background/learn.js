(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;
  const KEYS = { learn: "zz.learn" };
  const MAX_PATTERNS = 500;

  const cache = { data: null };
  let persistTimer = null;

  const AD_TOKEN =
    /(^|[-_ ])(ad|ads|advert|sponsor|promo|banner|popup|preroll|overlay)([-_ ]|$)|adsbygoogle|taboola|outbrain|mgid|dable|google[_-]?ads|ad[-_]?(slot|sense|banner|box|wrap|container|unit|zone)/i;

  async function load() {
    if (cache.data) return cache.data;
    try {
      const res = await ZZ.call(api.storage.local, "get", KEYS.learn);
      cache.data = (res && res[KEYS.learn]) || { patterns: {} };
      if (!cache.data.patterns) cache.data.patterns = {};
    } catch (e) {
      cache.data = { patterns: {} };
    }
    return cache.data;
  }

  function persist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const obj = {};
      obj[KEYS.learn] = cache.data || { patterns: {} };
      ZZ.call(api.storage.local, "set", obj).catch(() => {});
    }, 800);
  }

  function isLearnable(selector) {
    const s = String(selector || "").trim();
    if (!s || s.length > 120) return false;
    if (!/^[.#[]/.test(s)) return false;
    if (/nth-child|body\b|html\b|:root|[<>]/.test(s)) return false;
    if (/[{}@;]|url\s*\(/i.test(s)) return false;
    return AD_TOKEN.test(s);
  }

  const Learn = {
    KEYS,

    async patterns() {
      const data = await load();
      return data.patterns;
    },

    async observe(host, selector, genericSelector) {
      if (!host) return null;
      const gen = genericSelector || selector;
      if (!isLearnable(gen)) return null;
      const data = await load();
      const p =
        data.patterns[gen] ||
        (data.patterns[gen] = { hosts: [], count: 0, applied: false, lastAt: 0, selector: gen });
      if (p.hosts.indexOf(host) < 0) p.hosts.push(host);
      if (p.hosts.length > 40) p.hosts = p.hosts.slice(-40);
      p.count = (p.count || 0) + 1;
      p.lastAt = Date.now();
      p.host = host;
      p.selector = gen;
      const keys = Object.keys(data.patterns);
      if (keys.length > MAX_PATTERNS) delete data.patterns[keys[0]];
      persist();
      return p;
    },

    async candidates() {
      const s = ZZ.Store.settings();
      const minSites = (s.learning && s.learning.minSites) || 2;
      const data = await load();
      return Object.entries(data.patterns)
        .filter(([, p]) => !p.applied && new Set(p.hosts || []).size >= minSites)
        .map(([selector, p]) => ({
          selector,
          sites: new Set(p.hosts || []).size,
          hosts: (p.hosts || []).slice(-8),
          count: p.count || 0,
          lastAt: p.lastAt || 0,
        }))
        .sort((a, b) => b.sites - a.sites || b.count - a.count);
    },

    async all() {
      const data = await load();
      return Object.entries(data.patterns)
        .map(([selector, p]) => ({
          selector,
          sites: new Set(p.hosts || []).size,
          hosts: (p.hosts || []).slice(-8),
          count: p.count || 0,
          applied: !!p.applied,
          lastAt: p.lastAt || 0,
        }))
        .sort((a, b) => b.lastAt - a.lastAt);
    },

    async markApplied(selector) {
      const data = await load();
      if (data.patterns[selector]) {
        data.patterns[selector].applied = true;
        persist();
      }
    },

    async remove(selector) {
      const data = await load();
      delete data.patterns[selector];
      persist();
    },

    async clear() {
      cache.data = { patterns: {} };
      persist();
    },

    async maybeGeneralize(host, selector, genericSelector) {
      const s = ZZ.Store.settings();
      if (!s.learning || s.learning.autoApply === false) return null;
      const p = await Learn.observe(host, selector, genericSelector);
      if (!p || p.applied) return null;
      const minSites = (s.learning && s.learning.minSites) || 2;
      const sites = new Set(p.hosts || []).size;
      if (sites < minSites) return null;
      const F = ZZ.RuleFormat;
      const gen = p.selector;
      if (F.validateSelector(gen)) return null;
      if (ZZ.Store.rules().some((r) => r.selector === gen && !r.domains.length)) {
        await Learn.markApplied(gen);
        return null;
      }
      const rule = F.normalize(
        {
          kind: "cosmetic",
          action: "hide",
          selector: gen,
          domains: [],
          source: "learn",
          note: ZZ.T("自动学习：已在 $1 个站点出现", sites),
        },
        "learn"
      );
      if (!rule || F.validateRule(rule)) return null;
      await ZZ.Store.addRules([rule]);
      await Learn.markApplied(gen);
      return rule;
    },
  };

  ZZ.Learn = Learn;
})();

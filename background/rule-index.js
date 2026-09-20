(function () {
  const ZZ = globalThis.ZZ;
  const F = ZZ.RuleFormat;

  const GROUPS = [
    { id: "common", name: "通用拦截", desc: "所有站点生效的基础规则" },
    { id: "region", name: "区域站点", desc: "日本、韩国、俄罗斯、欧洲、东南亚、印度、拉美、港澳台" },
    { id: "social", name: "搜索 / 社交 / 社区", desc: "搜索引擎、社交平台、论坛" },
    { id: "video", name: "视频 / 直播", desc: "长视频、短视频、直播平台" },
    { id: "news", name: "资讯 / 技术 / 电商", desc: "门户资讯、技术社区、购物平台" },
    { id: "media", name: "影音娱乐", desc: "音乐、游戏、体育" },
    { id: "life", name: "生活服务", desc: "财经、旅游、教育、工具与网盘" },
    { id: "vertical", name: "垂直站点", desc: "问答、论坛、下载站、成人站点" },
  ];

  const PACKS = [
    { id: "core", group: "common", file: "rules/pack-core.json", name: "核心拦截", desc: "通用广告位元素 + 主流追踪/广告域名" },
    { id: "adnetworks", group: "common", file: "rules/pack-adnetworks.json", name: "广告联盟", desc: "Google/DoubleClick/Taboola/Outbrain/百度/广点通等联盟" },
    { id: "annoyances", group: "common", file: "rules/pack-annoyances.json", name: "弹窗骚扰", desc: "Cookie 同意框、登录墙、邮件订阅、App 下载浮层" },
    { id: "longtail", group: "common", file: "rules/pack-longtail.json", name: "长尾站点通用", desc: "小说/漫画/小型站点模板的经典广告位与弹层" },
    { id: "oss", group: "common", file: "rules/pack-oss.json", name: "开源合并规则", desc: "EasyList/EasyPrivacy/AdGuard/uBlock/CJX/1Hosts 等开源列表去重合并" },

    { id: "search", group: "social", file: "rules/pack-search.json", name: "搜索引擎广告", desc: "Google/Bing/百度/搜狗/360/DDG/Yandex 结果页推广位" },
    { id: "social-cn", group: "social", file: "rules/pack-social-cn.json", name: "国内社交资讯", desc: "微博/小红书/豆瓣/贴吧/头条/门户新闻" },
    { id: "intl-social", group: "social", file: "rules/pack-intl-social.json", name: "海外社交", desc: "X(Twitter)/Facebook/Instagram/TikTok/Pinterest/Quora" },
    { id: "forum", group: "social", file: "rules/pack-forum.json", name: "论坛 / BBS", desc: "Discuz/phpwind 通用广告位与虎扑/NGA 等社区" },

    { id: "youtube", group: "video", file: "rules/pack-youtube.json", name: "YouTube", desc: "首页/播放页广告位、视频内广告自动跳过" },
    { id: "video-cn", group: "video", file: "rules/pack-video-cn.json", name: "国内视频", desc: "B站/爱奇艺/腾讯视频/优酷/芒果TV/抖音/快手" },
    { id: "live", group: "video", file: "rules/pack-live.json", name: "直播平台", desc: "斗鱼/虎牙/B站直播/Twitch" },

    { id: "news", group: "news", file: "rules/pack-news.json", name: "资讯原生广告", desc: "资讯/门户/博客的原生信息流与软文推广" },
    { id: "tech-cn", group: "news", file: "rules/pack-tech-cn.json", name: "技术社区", desc: "CSDN/掘金/博客园/简书 的广告位与登录/关注弹窗" },
    { id: "shopping", group: "news", file: "rules/pack-shopping.json", name: "电商平台", desc: "淘宝天猫/京东/Amazon/eBay/AliExpress 推广位" },

    { id: "zhihu", group: "vertical", file: "rules/pack-zhihu.json", name: "知乎", desc: "信息流广告、推荐卡、开屏/App 引导" },
    { id: "reddit", group: "vertical", file: "rules/pack-reddit.json", name: "Reddit", desc: "推广帖、侧栏广告、嵌入广告" },
    { id: "linkedin", group: "vertical", file: "rules/pack-linkedin.json", name: "LinkedIn", desc: "Sponsored 推广动态、侧栏广告、推广卡" },
    { id: "warez", group: "vertical", file: "rules/pack-warez.json", name: "资源/下载站", desc: "迷惑性下载按钮、高速下载诱导、弹窗下载" },
    { id: "adult", group: "vertical", file: "rules/pack-adult.json", name: "成人站点", desc: "信息流广告、弹窗/弹底、跳转劫持入口" },

    { id: "jp", group: "region", file: "rules/pack-jp.json", name: "日本站点", desc: "Yahoo! JAPAN / はてな / 価格.com / 5ch / ニコニコ / Ameba / FC2" },
    { id: "kr", group: "region", file: "rules/pack-kr.json", name: "韩国站点", desc: "Naver / Daum / DCInside / Clien / Ruliweb / Tistory" },
    { id: "ru", group: "region", file: "rules/pack-ru.json", name: "俄罗斯 / 独联体", desc: "Yandex / Mail.ru / Rambler / RIA / Lenta / Habr / VK" },
    { id: "eu", group: "region", file: "rules/pack-eu.json", name: "欧洲站点", desc: "英德法意西波荷新闻门户的广告位与联盟" },
    { id: "sea", group: "region", file: "rules/pack-sea.json", name: "东南亚站点", desc: "越南 / 泰国 / 印尼 / 马来西亚门户与社区" },
    { id: "in", group: "region", file: "rules/pack-in.json", name: "印度站点", desc: "Times of India / NDTV / News18 与印度广告联盟" },
    { id: "latam", group: "region", file: "rules/pack-latam.json", name: "拉美站点", desc: "巴西 / 阿根廷 / 墨西哥门户与新闻站" },
    { id: "hktw", group: "region", file: "rules/pack-hktw.json", name: "港澳台站点", desc: "PIXNET / udn / ETtoday / 巴哈姆特 / HK01 / 讨论区" },

    { id: "music", group: "media", file: "rules/pack-music.json", name: "音乐 / 音频", desc: "Spotify / SoundCloud / 网易云 / QQ音乐 / 酷狗 / 酷我" },
    { id: "gaming", group: "media", file: "rules/pack-gaming.json", name: "游戏 / 电竞", desc: "IGN / GameSpot / 游民星空 / 3DM / 游侠 / 17173 / Fandom" },
    { id: "sports", group: "media", file: "rules/pack-sports.json", name: "体育站点", desc: "ESPN / Bleacher Report / Flashscore / 直播吧 / 懂球帝" },

    { id: "finance", group: "life", file: "rules/pack-finance.json", name: "财经 / 股票", desc: "新浪财经 / 东方财富 / 同花顺 / 雪球 / MarketWatch" },
    { id: "travel", group: "life", file: "rules/pack-travel.json", name: "旅游 / 出行", desc: "携程 / 去哪儿 / 马蜂窝 / Booking / Agoda / Trip.com" },
    { id: "edu", group: "life", file: "rules/pack-edu.json", name: "教育 / 学术 / 文档", desc: "知网 / 道客巴巴 / 豆丁 / 百度文库 / 在线课程" },
    { id: "tools", group: "life", file: "rules/pack-tools.json", name: "工具 / 网盘 / 天气", desc: "网盘下载、天气、快递、查询类高广告密度站点" },
  ];

  const CACHE_PAYLOAD = 600;
  const payloadCache = new Map();
  let packCache = null;
  let currentRules = [];
  let index = null;
  let compatIndex = null;
  let version = 0;

  function buildIndex(allRules) {
    const idx = emptyIndex();
    const seen = new Set();
    const byCanonical = new Map();
    for (let rule of allRules) {
      rule = F.normalize(rule, rule.source);
      if (!rule || rule.enabled === false) continue;
      if (F.validateRule(rule)) {
        idx.stats.dropped++;
        continue;
      }
      const key = F.canonicalKey(rule);
      const prev = byCanonical.get(key);
      if (prev) {
        if (ruleWeight(rule) < ruleWeight(prev)) byCanonical.set(key, rule);
        continue;
      }
      byCanonical.set(key, rule);
      seen.add(key);
    }

    function push(map, key, value) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    }

    for (const rule of byCanonical.values()) {
      if (rule.kind === "network") {
        idx.network.push(rule);
        if (rule.action === "block") {
          for (const host of RuleIndex.extractHosts(rule.filter || "")) idx.networkHosts.add(host);
        } else {
          idx.stats.allow++;
        }
        idx.stats.network++;
        continue;
      }
      if (rule.kind === "text") {
        const bucket = { rule };
        if (!rule.domains.length) idx.texts.global.push(bucket);
        else for (const d of rule.domains) push(idx.texts.byDomain, d, bucket);
        idx.stats.text++;
        continue;
      }
      const isException = rule.action === "allow";
      const isRemove = rule.action === "remove";
      const target = isException ? idx.exceptions : isRemove ? idx.removes : idx.cosmetics;
      if (isRemove) {
        if (!rule.domains.length) idx.cosmetics.global.add(rule.selector);
        else for (const d of rule.domains) addTo(idx.cosmetics.byDomain, d, rule.selector);
      }
      if (!rule.domains.length) target.global.add(rule.selector);
      else for (const d of rule.domains) addTo(target.byDomain, d, rule.selector);
      if (!isException && rule.excludeDomains && rule.excludeDomains.length) {
        for (const d of rule.excludeDomains) {
          if (!idx.cosmeticExcludes.has(d)) idx.cosmeticExcludes.set(d, new Set());
          idx.cosmeticExcludes.get(d).add(rule.selector);
        }
      }
      idx.stats.cosmetic++;
    }

    idx.rules = Array.from(byCanonical.values());
    return idx;
  }

  function emptyIndex() {
    return {
      rules: [],
      cosmetics: { global: new Set(), byDomain: new Map() },
      exceptions: { global: new Set(), byDomain: new Map() },
      cosmeticExcludes: new Map(),
      removes: { global: new Set(), byDomain: new Map() },
      removeExceptions: { global: new Set(), byDomain: new Map() },
      texts: { global: [], byDomain: new Map() },
      network: [],
      networkHosts: new Set(),
      stats: { cosmetic: 0, network: 0, text: 0, allow: 0, dropped: 0 },
    };
  }

  function addTo(map, domain, value) {
    if (!map.has(domain)) map.set(domain, new Set());
    map.get(domain).add(value);
  }

  function sourceWeight(rule) {
    const s = rule.source;
    if (s === "user") return 0;
    if (s === "ai") return 1;
    if (s === "learn") return 2;
    if (s === "scan") return 3;
    if (s === "import") return 4;
    return 5;
  }

  function ruleWeight(rule) {
    if (rule.priority) return -rule.priority;
    return sourceWeight(rule);
  }

  const RuleIndex = {
    PACKS,
    GROUPS,

    groupOf(packId) {
      const pack = PACKS.find((p) => p.id === packId);
      return pack ? pack.group : "common";
    },

    version() {
      return version;
    },

    async loadPacks() {
      if (packCache) return packCache;
      const out = {};
      await Promise.all(
        PACKS.map(async (p) => {
          try {
            const res = await fetch(ZZ.browser.runtime.getURL(p.file));
            const data = await res.json();
            out[p.id] = Array.isArray(data.rules) ? data.rules : [];
            if (data.name) p.name = data.name;
            if (data.desc) p.desc = data.desc;
          } catch (e) {
            ZZ.warn("pack load failed", p.id, e && e.message);
            out[p.id] = [];
          }
        })
      );
      packCache = out;
      return out;
    },

    packRules(enabledPacks) {
      const out = [];
      const packs = packCache || {};
      for (const p of PACKS) {
        if (enabledPacks && enabledPacks[p.id] === false) continue;
        const list = packs[p.id] || [];
        list.forEach((raw, i) => {
          const rule = F.normalize(
            Object.assign({}, raw, { id: "b:" + p.id + ":" + i, pack: p.id, source: "builtin" }),
            "builtin"
          );
          if (F.validateRule(rule)) return;
          out.push(rule);
        });
      }
      return out;
    },

    build(userRules, packsEnabled) {
      const fullRules = (this.packRules(packsEnabled) || []).concat(userRules || []);
      index = buildIndex(fullRules);
      const compatPacks = ZZ.Profiles ? ZZ.Profiles.packMap("compat", packsEnabled) : packsEnabled;
      compatIndex = buildIndex((this.packRules(compatPacks) || []).concat(userRules || []));
      version++;
      payloadCache.clear();
      return index;
    },

    current() {
      return index || emptyIndex();
    },

    indexFor(profile) {
      if (profile === "compat" && compatIndex) return compatIndex;
      return index || emptyIndex();
    },

    domainMatches(host, domain) {
      return F.ruleDomainMatch(host, domain);
    },

    extractHosts(filter) {
      const out = [];
      const s = String(filter || "");
      const re = /(?:^|[|]{2}|https?:\/\/|\/\/)([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi;
      let m;
      while ((m = re.exec(s))) out.push(m[1].toLowerCase());
      if (!out.length) {
        const m2 = /(?:^|[^a-z0-9.-])([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)(?=[^a-z0-9-]|$)/i.exec(s);
        if (m2) out.push(m2[1].toLowerCase());
      }
      if (!out.length && !/[/*^|]/.test(s) && /\./.test(s)) out.push(s.toLowerCase());
      return out;
    },

    applicable(host, profile) {
      const idx = this.indexFor(profile);
      const hide = new Set();
      for (const s of idx.cosmetics.global) hide.add(s);
      for (const [domain, set] of idx.cosmetics.byDomain) {
        if (F.ruleDomainMatch(host, domain)) for (const s of set) hide.add(s);
      }
      const exceptions = new Set();
      for (const s of idx.exceptions.global) exceptions.add(s);
      for (const [domain, set] of idx.exceptions.byDomain) {
        if (F.ruleDomainMatch(host, domain)) for (const s of set) exceptions.add(s);
      }
      for (const s of exceptions) hide.delete(s);
      for (const [domain, set] of idx.cosmeticExcludes) {
        if (F.ruleDomainMatch(host, domain)) for (const s of set) hide.delete(s);
      }

      const remove = new Set();
      for (const s of idx.removes.global) if (!exceptions.has(s)) remove.add(s);
      for (const [domain, set] of idx.removes.byDomain) {
        if (F.ruleDomainMatch(host, domain)) {
          for (const s of set) if (!exceptions.has(s)) remove.add(s);
        }
      }

      const texts = idx.texts.global.slice();
      for (const [domain, list] of idx.texts.byDomain) {
        if (F.ruleDomainMatch(host, domain)) texts.push.apply(texts, list);
      }

      return {
        version: version,
        host: host,
        hide: Array.from(hide),
        remove: Array.from(remove),
        texts: texts.map((t) => t.rule).slice(0, 30),
        unlockScroll: Array.from(hide).some((s) => /cookie|consent|gdpr|onetrust|didomi|sp_message|cmp|age-?gate|paywall/i.test(s)),
        stats: JSON.parse(JSON.stringify(idx.stats)),
      };
    },

    buildCss(selectors, chunkSize) {
      const size = chunkSize || 30;
      const out = [];
      const clean = Array.from(new Set((selectors || []).filter(Boolean)));
      for (let i = 0; i < clean.length; i += size) {
        const chunk = clean.slice(i, i + size);
        out.push(chunk.join(",\n") + "\n{display: none !important;}");
      }
      return out.join("\n");
    },

    payload(host, opts) {
      const profile = (opts && opts.profile) || "standard";
      const key = host + "|" + profile + "|" + (opts && opts.includeRemove ? "1" : "0");
      if (payloadCache.has(key) && payloadCache.get(key).version === version) {
        return payloadCache.get(key);
      }
      const app = this.applicable(host, profile);
      const flags = ZZ.Profiles ? ZZ.Profiles.flags(profile) : { textRules: true, unlockScroll: "auto", aggressive: false };
      const payload = {
        version: app.version,
        host: host,
        profile: profile,
        css: RuleIndex.buildCss(app.hide.concat(app.remove)),
        hideCount: app.hide.length,
        remove: app.remove,
        texts: flags.textRules ? app.texts : [],
        textRules: flags.textRules !== false,
        textRemove: flags.aggressive === true,
        unlockScroll: flags.unlockScroll === true || (flags.unlockScroll === "auto" && app.unlockScroll),
        aggressive: flags.aggressive === true,
        stats: app.stats,
      };
      if (payloadCache.size > CACHE_PAYLOAD) payloadCache.clear();
      payloadCache.set(key, payload);
      return payload;
    },

    compileDNR(budget) {
      const idx = this.current();
      const max = typeof budget === "number" && budget > 0 ? budget : 4500;
      const allowed = idx.network.filter((r) => r.action === "allow");
      const blocked = idx.network.filter((r) => r.action !== "allow");
      const ordered = allowed
        .slice()
        .sort((a, b) => ruleWeight(a) - ruleWeight(b))
        .concat(blocked.slice().sort((a, b) => ruleWeight(a) - ruleWeight(b)));
      const out = [];
      const dropped = [];
      let id = 1;
      for (const rule of ordered) {
        const dnr = toDnr(rule, id);
        if (!dnr) {
          dropped.push({ rule, reason: "invalid" });
          continue;
        }
        if (out.length >= max) {
          dropped.push({ rule, reason: "budget" });
          continue;
        }
        out.push(dnr);
        id++;
      }
      return { rules: out, dropped, total: ordered.length };
    },

    stats() {
      const idx = this.current();
      return {
        version,
        cosmetic: idx.stats.cosmetic,
        network: idx.stats.network,
        text: idx.stats.text,
        allow: idx.stats.allow,
        invalid: idx.stats.dropped,
        networkHosts: idx.networkHosts.size,
        packs: PACKS.length,
      };
    },
  };

  function toDnr(rule, id) {
    const condition = {
      isUrlFilterCaseSensitive: false,
      resourceTypes:
        rule.resourceTypes && rule.resourceTypes.length
          ? rule.resourceTypes.slice()
          : F.DEFAULT_RESOURCE_TYPES.slice(),
    };
    if (rule.action === "allow" && !condition.resourceTypes.includes("main_frame")) {
      condition.resourceTypes.push("main_frame");
    }
    if (rule.regexFilter) {
      condition.regexFilter = String(rule.regexFilter).replace(/^\//, "").replace(/\/$/, "");
      condition.isUrlFilterCaseSensitive = false;
    } else {
      condition.urlFilter = rule.filter;
    }
    if (rule.domains && rule.domains.length) condition.initiatorDomains = rule.domains;
    if (rule.excludeDomains && rule.excludeDomains.length) {
      condition.excludedInitiatorDomains = rule.excludeDomains;
    }
    if (rule.domainType) condition.domainType = rule.domainType;
    return {
      id: id,
      priority: rule.action === "allow" ? 100 : Math.min(rule.priority || 1, 110),
      action: { type: rule.action === "allow" ? "allow" : "block" },
      condition,
    };
  }

  ZZ.RuleIndex = RuleIndex;
})();

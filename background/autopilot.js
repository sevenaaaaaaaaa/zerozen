(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;

  const LOG_MAX = 200;
  const state = {
    running: false,
    phase: "",
    total: 0,
    done: 0,
    findings: 0,
    applied: 0,
    error: "",
    sites: [],
    log: [],
    startedAt: 0,
    lastRunAt: 0,
  };

  function log(text, level) {
    state.log.push({ text, level: level || "", at: Date.now() });
    if (state.log.length > LOG_MAX) state.log.shift();
    ZZ.log("[autopilot]", text);
  }

  function isLocalUrl(url) {
    try {
      const u = new URL(String(url || ""));
      const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
      return h.endsWith(".local") || h.endsWith(".localhost") || /^127\./.test(h) || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h);
    } catch (e) {
      return false;
    }
  }

  function aiLocalReady() {
    const s = ZZ.Store.settings();
    const ai = s.ai || {};
    if (!ai.enabled || !ai.baseUrl) return false;
    return isLocalUrl(ai.baseUrl);
  }

  async function historySites(opts) {
    if (!api.history || !api.history.search) {
      return { ok: false, error: ZZ.T("浏览器未提供历史记录接口（需先授予「浏览记录」权限）") };
    }
    const s = ZZ.Store.settings();
    const cfg = Object.assign({}, s.autonomous || {}, opts || {});
    const minVisits = Math.max(1, Number(cfg.minVisits) || 3);
    const maxSites = Math.max(1, Math.min(50, Number(cfg.maxSites) || 15));
    const since = Date.now() - 1000 * 60 * 60 * 24 * 30;
    let items = [];
    try {
      items = (await ZZ.call(api.history, "search", { text: "", startTime: since, maxResults: 5000 })) || [];
    } catch (e) {
      return { ok: false, error: (e && e.message) || ZZ.T("读取历史记录失败") };
    }
    const map = new Map();
    const includeLocal = cfg.includeLocal === true;
    for (const it of items) {
      if (!/^https?:/i.test(it.url || "")) continue;
      const host = ZZ.hostOf(it.url || "");
      if (!host) continue;
      if (!includeLocal && (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host) || host.endsWith(".local"))) continue;
      const cur = map.get(host) || { host, visits: 0, last: 0, url: "", title: "" };
      cur.visits += it.visitCount || 1;
      cur.last = Math.max(cur.last, it.lastVisitTime || 0);
      if (!cur.url) {
        cur.url = it.url;
        cur.title = it.title || "";
      }
      map.set(host, cur);
    }
    let list = Array.from(map.values()).filter((x) => x.visits >= minVisits);
    const scanCache = ZZ.Store.scanCache();
    if (cfg.skipScanned !== false) {
      const now = Date.now();
      list = list.filter((x) => !scanCache[x.host] || now - (scanCache[x.host].at || 0) > 1000 * 60 * 60 * 24 * 3);
    }
    list.sort((a, b) => b.visits - a.visits || b.last - a.last);
    list = list.slice(0, maxSites);
    return { ok: true, sites: list, minVisits, maxSites };
  }

  async function run(opts) {
    if (state.running) return { ok: false, error: ZZ.T("已有自主增强任务在运行") };
    const s = ZZ.Store.settings();
    const cfg = Object.assign({}, s.autonomous || {}, opts || {});
    if (!cfg.enabled && !(opts && opts.force)) return { ok: false, error: ZZ.T("自主增强未启用") };
    if (!aiLocalReady()) {
      return { ok: false, error: ZZ.T("自主增强仅支持本地模型（在「AI 识别」里填写 127.0.0.1 / localhost 的本地地址并启用）") };
    }

    state.running = true;
    state.phase = "history";
    state.total = 0;
    state.done = 0;
    state.findings = 0;
    state.applied = 0;
    state.error = "";
    state.sites = [];
    state.log = [];
    state.startedAt = Date.now();
    log(ZZ.T("读取浏览记录，筛选常访问站点…"));

    try {
      const hist = await historySites(cfg);
      if (!hist.ok) {
        state.error = hist.error;
        log("× " + hist.error, "err");
        state.running = false;
        state.phase = "error";
        return { ok: false, error: hist.error };
      }
      const sites = hist.sites;
      state.sites = sites.map((x) => x.host);
      state.total = sites.length;
      if (!sites.length) {
        log(ZZ.T("没有满足条件（访问 ≥$1 次）的站点", hist.minVisits));
        state.running = false;
        state.phase = "done";
        return { ok: true, sites: 0, findings: 0, applied: 0 };
      }
      log(ZZ.T("选中 $1 个站点：$2", sites.length, sites.map((x) => x.host).join("、")));

      state.phase = "scan";
      const res = await ZZ.Scanner.start(
        {
          sites: sites.map((x) => ({ host: x.host, url: x.url, title: x.title })),
          aiReview: true,
          skipScanned: false,
          maxSites: sites.length,
          delayMs: (s.scanning && s.scanning.delayMs) || 800,
          concurrency: 1,
          mode: "render",
        },
        null
      );
      if (!res || !res.ok) {
        state.error = (res && res.error) || ZZ.T("扫描失败");
        log("× " + state.error, "err");
        state.running = false;
        state.phase = "error";
        return res || { ok: false, error: state.error };
      }
      state.done = sites.length;
      log(ZZ.T("扫描完成，共 $1 个站点", sites.length));

      state.phase = "apply";
      const threshold = Number(cfg.threshold) || (s.ai && s.ai.minConfidence) || 0.75;
      const hosts = new Set(sites.map((x) => x.host));
      const pending = ZZ.Store.findings().filter(
        (f) => hosts.has(f.host) && f.status === "pending" && (f.confidence || 0) >= threshold
      );
      state.findings = pending.length;
      if (pending.length && cfg.autoApply !== false) {
        const F = ZZ.RuleFormat;
        const rules = [];
        for (const f of pending) {
          rules.push.apply(rules, ZZ.Findings.toRules(f, "site"));
          if (ZZ.Learn) await ZZ.Learn.observe(f.host, f.selector, f.genericSelector);
        }
        if (rules.length) {
          await ZZ.Store.addRules(F.dedupe(rules));
          const now = Date.now();
          const all = ZZ.Store.findings().slice();
          for (const f of all) {
            if (pending.some((x) => x.id === f.id)) {
              f.status = "applied";
              f.appliedAt = now;
            }
          }
          await ZZ.Store.saveFindings(all);
          await ZZ.Main.rebuild({ dnr: true, refresh: true });
          state.applied = pending.length;
          log(ZZ.T("已自动应用 $1 条规则（置信度 ≥$2）", pending.length, threshold));
        }
      } else if (pending.length) {
        log(ZZ.T("产生 $1 条待审（未开启自动应用）", pending.length));
      } else {
        log(ZZ.T("未发现需要处理的新规则"));
      }

      await ZZ.Store.saveSettings({ autonomous: Object.assign({}, cfg, { lastRunAt: Date.now() }) });
      state.lastRunAt = Date.now();
      state.running = false;
      state.phase = "done";
      return { ok: true, sites: sites.length, findings: state.findings, applied: state.applied };
    } catch (e) {
      state.error = (e && e.message) || String(e);
      state.running = false;
      state.phase = "error";
      log("× " + state.error, "err");
      return { ok: false, error: state.error };
    }
  }

  const Autopilot = {
    isLocalUrl,
    aiLocalReady,

    historySites,

    run,

    stop() {
      try {
        ZZ.Scanner.stop("user");
      } catch (e) {}
      state.running = false;
      state.phase = "stopped";
      log(ZZ.T("已停止"));
      return { ok: true };
    },

    status() {
      return {
        running: state.running,
        phase: state.phase,
        total: state.total,
        done: state.done,
        findings: state.findings,
        applied: state.applied,
        error: state.error,
        sites: state.sites,
        startedAt: state.startedAt,
        lastRunAt: state.lastRunAt,
        localReady: aiLocalReady(),
        historyReady: !!(api.history && api.history.search),
        log: state.log.slice(-80),
      };
    },

    async schedule() {
      const s = ZZ.Store.settings();
      const cfg = s.autonomous || {};
      if (!cfg.enabled || cfg.weekly === false) return;
      if (Date.now() - (cfg.lastRunAt || 0) < 7 * 24 * 3600 * 1000) return;
      if (!aiLocalReady()) return;
      setTimeout(() => {
        Autopilot.run({ force: true }).catch(() => {});
      }, 20000);
    },
  };

  ZZ.Autopilot = Autopilot;
})();

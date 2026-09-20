(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;
  const F = ZZ.RuleFormat;

  const waiters = new Map();

  function findingFingerprint(host, selector) {
    return host + "|" + String(selector || "").replace(/\s+/g, " ").trim();
  }

  const Findings = {
    fromAi(host, url, title, list, opts) {
      const out = [];
      for (const f of list || []) {
        if (!f || !f.selector) continue;
        const fp = findingFingerprint(host, f.selector);
        out.push({
          id: ZZ.uid("f"),
          host,
          url: String(url || "").slice(0, 300),
          title: String(title || "").slice(0, 160),
          selector: f.selector,
          genericSelector: f.genericSelector || "",
          generic: !!f.generic,
          category: f.category || "other",
          confidence: typeof f.confidence === "number" ? f.confidence : 0.5,
          reason: f.reason || "",
          blockDomain: f.blockDomain || "",
          source: (opts && opts.source) || "ai",
          status: "pending",
          createdAt: Date.now(),
          sample: (f.candidate && f.candidate.text) || "",
          fingerprint: fp,
        });
      }
      return out;
    },

    fromLocal(host, url, title, candidates, opts) {
      const minScore = (opts && opts.minScore) || 55;
      const out = [];
      for (const c of candidates || []) {
        if (!c || c.score < minScore) continue;
        const selector = c.gen || c.sel;
        if (!selector) continue;
        const fp = findingFingerprint(host, selector);
        out.push({
          id: ZZ.uid("f"),
          host,
          url: String(url || "").slice(0, 300),
          title: String(title || "").slice(0, 160),
          selector,
          genericSelector: c.gen || "",
          generic: !!c.gen,
          category: (opts && opts.category) || "other",
          confidence: Math.max(0.3, Math.min(0.9, c.score / 100)),
          reason: "本地启发式命中：" + (c.signals || []).slice(0, 4).join("、"),
          blockDomain: c.adHost || "",
          source: "scan",
          status: "pending",
          createdAt: Date.now(),
          sample: (c.text || "").slice(0, 140),
          fingerprint: fp,
        });
      }
      return out;
    },

    async persist(list, appliedFingerprints) {
      const incoming = (list || []).filter(Boolean);
      if (!incoming.length) return [];
      const before = new Set(ZZ.Store.findings().map((f) => f.fingerprint));
      const fresh = incoming.filter((f) => !before.has(f.fingerprint));
      if (fresh.length) await ZZ.Store.addFindings(fresh);
      const applied = appliedFingerprints instanceof Set ? appliedFingerprints : new Set();
      if (applied.size) {
        const all = ZZ.Store.findings().slice();
        let dirty = false;
        for (const f of all) {
          if (applied.has(f.fingerprint) && f.status !== "applied") {
            f.status = "applied";
            f.appliedAt = Date.now();
            dirty = true;
          }
        }
        if (dirty) await ZZ.Store.saveFindings(all);
      }
      const byFingerprint = new Map(ZZ.Store.findings().map((f) => [f.fingerprint, f]));
      const out = [];
      const seen = new Set();
      for (const f of incoming) {
        const stored = byFingerprint.get(f.fingerprint);
        if (!stored || seen.has(stored.id)) continue;
        seen.add(stored.id);
        out.push(stored);
      }
      return out;
    },

    toRules(finding, scope) {
      const rules = [];
      const domains = scope === "global" ? [] : [finding.host];
      const selector = scope === "global" ? finding.genericSelector || finding.selector : finding.selector;
      const err = F.validateSelector(selector);
      if (!err) {
        rules.push(
          F.normalize(
            {
              kind: "cosmetic",
              action: "hide",
              selector,
              domains,
              source: finding.source === "ai" ? "ai" : "scan",
              note: finding.reason || finding.category,
            },
            finding.source
          )
        );
      }
      if (finding.blockDomain) {
        rules.push(
          F.normalize(
            {
              kind: "network",
              action: "block",
              filter: "||" + finding.blockDomain + "^",
              domains: scope === "global" ? [] : [finding.host],
              source: "ai",
              note: finding.reason || "AI 识别广告域",
            },
            "ai"
          )
        );
      }
      return rules;
    },
  };

  const Scanner = {
    state: null,

    status() {
      if (!this.state) return { running: false };
      const s = this.state;
      return {
        running: true,
        scanId: s.scanId,
        total: s.sites.length,
        done: s.done,
        findings: s.findings,
        mode: s.opts.mode,
        current: s.current,
        cancelled: s.cancelled,
      };
    },

    stop(reason) {
      if (!this.state) return { ok: true };
      this.state.cancelled = true;
      for (const [tabId, waiter] of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(false);
        waiters.delete(tabId);
      }
      if (this.state.currentTabId) {
        ZZ.call(api.tabs, "remove", this.state.currentTabId).catch(() => {});
      }
      return { ok: true, reason: reason || "user" };
    },

    onTabRemoved(tabId) {
      const waiter = waiters.get(tabId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      waiter.resolve(false);
      waiters.delete(tabId);
    },

    async start(opts, port) {
      if (this.state) return { ok: false, error: "已有扫描任务在运行" };
      const settings = ZZ.Store.settings();
      const scanCache = ZZ.Store.scanCache();
      const now = Date.now();
      let sites = (opts.sites || []).filter((s) => s && /^https?:/i.test(s.url));
      if (opts.skipScanned !== false && settings.scanning.skipScanned) {
        sites = sites.filter((s) => {
          const hit = scanCache[s.host];
          return !hit || now - hit.at > 1000 * 60 * 60 * 24 * 3;
        });
      }
      const maxSites = Math.max(1, opts.maxSites || settings.scanning.maxSites || 300);
      const skippedByLimit = Math.max(0, sites.length - maxSites);
      sites = sites.slice(0, maxSites);

      const state = {
        scanId: ZZ.uid("scan"),
        sites,
        done: 0,
        findings: 0,
        cancelled: false,
        currentTabId: null,
        current: "",
        aiCalls: 0,
        opts: Object.assign({}, settings.scanning, opts),
        port: port || null,
      };
      this.state = state;
      post({ type: "zz:scan:started", payload: { scanId: state.scanId, total: sites.length, skippedByLimit } });

      const concurrency = Math.max(1, Math.min(3, state.opts.concurrency || 1));
      const queue = sites.slice();
      const aiBudget = Math.max(0, settings.ai.budgetPerScan || 20);
      let aiUsed = 0;

      const worker = async () => {
        while (!state.cancelled) {
          const site = queue.shift();
          if (!site) return;
          state.current = site.host;
          let result;
          try {
            result = await scanSiteWithTab(site, state);
          } catch (e) {
            result = { ok: false, error: (e && e.message) || String(e) };
          }
          if (state.cancelled) return;
          try {
            if (result && result.ok) {
              const findings = Findings.fromLocal(site.host, result.url, result.title, result.candidates, {});
              if (state.opts.aiReview && ZZ.Ai.configured() && aiUsed < aiBudget && result.candidates.length) {
                const aiRes = await ZZ.Ai.classify({
                  host: site.host,
                  url: result.url,
                  title: result.title,
                  candidates: result.candidates,
                });
                aiUsed += aiRes.calls || 0;
                if (aiRes.ok) {
                  const aiFindings = Findings.fromAi(site.host, result.url, result.title, aiRes.findings, {
                    source: "ai",
                  });
                  for (const f of aiFindings) {
                    const i = findings.findIndex((x) => x.fingerprint === f.fingerprint);
                    if (i >= 0) findings[i] = f;
                    else findings.push(f);
                  }
                } else {
                  post({ type: "zz:scan:log", payload: { site: site.host, level: "warn", message: "AI: " + aiRes.error } });
                }
              }
              const saved = await saveFindings(site, findings, result);
              state.findings += saved.added;
              state.done++;
              scanCache[site.host] = { at: Date.now(), findings: saved.added, mode: state.opts.mode };
              await ZZ.Store.setScanCache(scanCache);
              post({
                type: "zz:scan:progress",
                payload: {
                  site: site.host,
                  status: "done",
                  findings: saved.added,
                  candidates: result.candidates.length,
                  index: state.done,
                  total: state.sites.length,
                },
              });
            } else {
              state.done++;
              post({
                type: "zz:scan:progress",
                payload: {
                  site: site.host,
                  status: "error",
                  error: (result && result.error) || "unknown",
                  index: state.done,
                  total: state.sites.length,
                },
              });
            }
          } catch (e) {
            state.done++;
            post({
              type: "zz:scan:progress",
              payload: {
                site: site.host,
                status: "error",
                error: (e && e.message) || String(e),
                index: state.done,
                total: state.sites.length,
              },
            });
          }
          if (state.opts.delayMs) await ZZ.sleep(state.opts.delayMs);
        }
      };

      let workerError = null;
      try {
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
      } catch (e) {
        workerError = (e && e.message) || String(e);
        ZZ.warn("scan worker failed", workerError);
      }
      const summary = {
        scanId: state.scanId,
        total: state.sites.length,
        done: state.done,
        findings: state.findings,
        cancelled: state.cancelled,
        aiCalls: aiUsed,
        error: workerError,
      };
      post({ type: "zz:scan:done", payload: summary });
      this.state = null;
      await ZZ.Dnr.sync().catch(() => {});
      return { ok: true, summary };
    },

    onPageReady(tabId, payload) {
      const waiter = waiters.get(tabId);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiters.delete(tabId);
        waiter.resolve(payload);
      }
      return { ok: true };
    },

    async collectFromTab(tabId, opts) {
      const res = await ZZ.sendToTab(tabId, {
        type: "zz:scan:collect",
        payload: { deep: !!(opts && opts.deep) },
      });
      return res;
    },
  };

  function post(message) {
    const state = Scanner.state;
    if (!state || !state.port) return;
    try {
      state.port.postMessage(message);
    } catch (e) {}
  }

  async function saveFindings(site, findings, result) {
    const settings = ZZ.Store.settings();
    const fresh = [];
    const existing = new Set(ZZ.Store.findings().map((f) => f.fingerprint));
    for (const f of findings) {
      if (existing.has(f.fingerprint)) continue;
      existing.add(f.fingerprint);
      fresh.push(f);
    }
    const autoApply =
      settings.ai.autoApply && settings.ai.enabled
        ? fresh.filter((f) => f.source === "ai" && f.confidence >= (settings.ai.minConfidence || 0.75))
        : [];
    const rules = [];
    for (const f of autoApply) {
      f.status = "applied";
      f.appliedAt = Date.now();
      rules.push.apply(rules, Findings.toRules(f, "site"));
      if (ZZ.Learn) {
        ZZ.Learn.observe(f.host, f.selector, f.genericSelector).catch(() => {});
      }
    }
    if (rules.length) {
      await ZZ.Store.addRules(F.dedupe(rules));
      await ZZ.RuleIndex.build(ZZ.Store.rules(), settings.packs);
    }
    const toSave = fresh.filter((f) => !autoApply.includes(f));
    if (toSave.length) await ZZ.Store.addFindings(toSave);
    return { added: toSave.length + autoApply.length, rules: rules.length };
  }

  async function scanSiteWithTab(site, state) {
    const tab = await ZZ.call(api.tabs, "create", { url: site.url, active: false });
    if (!tab || typeof tab.id !== "number") return { ok: false, error: "无法创建标签页" };
    state.currentTabId = tab.id;
    ZZ.call(api.tabs, "update", tab.id, { muted: true }).catch(() => {});
    try {
      const ready = await waitForReady(tab.id, state.opts.pageTimeoutMs || 20000);
      if (!ready) return { ok: false, error: "页面加载超时" };
      const collected = await Scanner.collectFromTab(tab.id, { deep: true });
      if (!collected || !collected.ok) {
        return { ok: false, error: (collected && collected.error) || "内容脚本无响应" };
      }
      return {
        ok: true,
        url: collected.url || site.url,
        title: collected.title || site.title || "",
        candidates: (collected.candidates || []).slice(0, 40),
      };
    } finally {
      await ZZ.call(api.tabs, "remove", tab.id).catch(() => {});
      state.currentTabId = null;
    }
  }

  function waitForReady(tabId, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(tabId);
        resolve(false);
      }, timeoutMs);
      waiters.set(tabId, { resolve, timer });
    });
  }

  ZZ.Findings = Findings;
  ZZ.Scanner = Scanner;
})();

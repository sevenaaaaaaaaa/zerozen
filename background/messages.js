(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;
  const F = ZZ.RuleFormat;

  function senderHost(sender) {
    const url = (sender && sender.tab && sender.tab.url) || (sender && sender.url) || "";
    return ZZ.hostOf(url);
  }

  async function importRules(text, opts) {
    const source = (opts && opts.source) || "import";
    const trimmed = String(text || "").trim();
    let result;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      result = F.parseNative(text);
      if (result.error) return { ok: false, error: result.error };
    } else {
      const converted = trimmed
        .split(/\r?\n/)
        .map((line) => {
          const l = line.trim();
          if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(l)) return "||" + l + "^";
          return line;
        })
        .join("\n");
      result = F.parseAdblockText(converted, { source });
    }
    const rules = F.dedupe(result.rules || []);
    const existing = new Set(ZZ.Store.rules().map((r) => F.canonicalKey(r)));
    const fresh = rules.map((r) => F.normalize(Object.assign({}, r, { id: ZZ.uid("r"), source }), source));
    const toAdd = [];
    let dupes = 0;
    for (const r of fresh) {
      const key = F.canonicalKey(r);
      if (existing.has(key)) {
        dupes++;
        continue;
      }
      existing.add(key);
      toAdd.push(r);
    }
    if (toAdd.length) {
      await ZZ.Store.addRules(toAdd);
      await ZZ.Main.rebuild({ dnr: true, refresh: true });
    }
    return {
      ok: true,
      added: toAdd.length,
      duplicates: dupes,
      skipped: (result.skipped || []).slice(0, 40),
      skippedCount: (result.skipped || []).length,
    };
  }

  async function rulesForHost(host, tabId) {
    const settings = ZZ.Store.settings();
    const eff = ZZ.Store.profileFor(host);
    if (!settings.enabled || eff.profile === "off") {
      return {
        ok: true,
        enabled: false,
        profile: "off",
        profileSource: eff.source,
        until: eff.until || 0,
        hide: [],
        remove: [],
        texts: [],
        textRules: false,
        unlockScroll: false,
        version: ZZ.RuleIndex.version(),
      };
    }
    const payload = ZZ.RuleIndex.payload(host, { profile: eff.profile });
    const out = {
      ok: true,
      enabled: true,
      profile: eff.profile,
      profileSource: eff.source,
      until: eff.until || 0,
      version: payload.version,
      hideCount: payload.hideCount,
      remove: settings.cosmetic ? payload.remove : [],
      texts: settings.cosmetic ? payload.texts : [],
      textRules: payload.textRules !== false,
      textRemove: !!payload.textRemove,
      aggressive: !!payload.aggressive,
      unlockScroll: payload.unlockScroll && settings.cosmetic,
      guard: { enabled: !!settings.popupGuard, notifications: !!settings.popupGuard },
      youtube: !!settings.youtubeAuto,
      hide: [],
      stats: payload.stats,
    };
    if (settings.countMatches && settings.cosmetic && payload.hideCount <= 4000) {
      const app = ZZ.RuleIndex.applicable(host, eff.profile);
      out.hide = app.hide.concat(app.remove);
    }
    return out;
  }

  function Store_enabled(host) {
    return ZZ.Store.siteEnabled(host);
  }

  const Messages = {
    async handle(msg, sender) {
      if (!msg || typeof msg !== "object" || !msg.type) return { ok: false, error: "bad message" };
      await ZZ.Main.init();
      const host = senderHost(sender);
      const tabId = sender && sender.tab ? sender.tab.id : undefined;

      switch (msg.type) {
        case "zz:get-rules": {
          const target = (msg.payload && msg.payload.host) || host;
          return rulesForHost(target, tabId);
        }

        case "zz:page-ready": {
          return ZZ.Scanner.onPageReady(tabId, msg.payload || {});
        }

        case "zz:stats": {
          const p = msg.payload || {};
          for (const key of ["cosmetic", "removed", "texts", "popups"]) {
            if (p[key]) ZZ.Counts.inc(tabId, key === "texts" ? "texts" : key, host, p[key]);
          }
          return { ok: true, counts: ZZ.Counts.get(tabId) };
        }

        case "zz:picker:result": {
          const p = msg.payload || {};
          const scope = p.scope === "global" ? "global" : "site";
          const selector = scope === "global" ? p.genericSelector || p.selector : p.selector;
          const err = F.validateSelector(selector);
          if (err) return { ok: false, error: err };
          const rule = F.normalize(
            {
              kind: "cosmetic",
              action: p.action === "remove" ? "remove" : "hide",
              selector,
              domains: scope === "global" ? [] : [p.host || host],
              source: "user",
              note: p.note || "手动选取",
            },
            "user"
          );
          await ZZ.Store.addRules([rule]);
          if (ZZ.Learn) await ZZ.Learn.maybeGeneralize(p.host || host, selector, p.genericSelector);
          await ZZ.Main.rebuild({ dnr: false, refresh: true });
          return { ok: true, rule };
        }

        case "zz:picker:allow": {
          const p = msg.payload || {};
          const err = F.validateSelector(p.selector);
          if (err) return { ok: false, error: err };
          const rule = F.normalize(
            {
              kind: "cosmetic",
              action: "allow",
              selector: p.selector,
              domains: p.scope === "global" ? [] : [p.host || host],
              source: "user",
              note: "手动放行",
            },
            "user"
          );
          await ZZ.Store.addRules([rule]);
          await ZZ.Main.rebuild({ dnr: false, refresh: true });
          return { ok: true, rule };
        }

        case "zz:report": {
          ZZ.log("page report", msg.payload);
          return { ok: true };
        }

        case "zz:state:get": {
          const settings = ZZ.Store.settings();
          const counts = ZZ.Counts.get(msg.payload && msg.payload.tabId);
          let stateHost = host;
          const targetTab = await getTab(msg.payload && msg.payload.tabId, sender);
          if (targetTab && targetTab.url) stateHost = ZZ.hostOf(targetTab.url) || stateHost;
          const eff = ZZ.Store.profileFor(stateHost);
          return {
            ok: true,
            enabled: settings.enabled,
            siteEnabled: eff.profile !== "off",
            host: stateHost,
            counts,
            profile: eff.profile,
            profileSource: eff.source,
            until: eff.until || 0,
            autoCompat: eff.autoCompat || null,
            globalProfile: settings.profile || "standard",
            autoFallback: settings.autoFallback !== false,
            tempMinutes: settings.tempMinutes || 30,
            types: {
              network: settings.network !== false,
              cosmetic: settings.cosmetic !== false,
              popup: settings.popupGuard !== false,
              annoyances: ZZ.Store.packEnabled("annoyances"),
            },
            aiConfigured: ZZ.Ai.configured(),
            dnr: ZZ.Dnr.lastResult,
            index: ZZ.RuleIndex.stats(),
            packs: ZZ.RuleIndex.PACKS.map((p) => ({
              id: p.id,
              name: p.name,
              desc: p.desc,
              group: p.group,
              enabled: ZZ.Store.packEnabled(p.id),
            })),
            findingsPending: ZZ.Store.findings().filter((f) => f.status === "pending").length,
            scanner: ZZ.Scanner.status(),
            version: ZZ.info.version,
          };
        }

        case "zz:settings:get": {
          const settings = ZZ.Store.settings();
          return {
            ok: true,
            settings: Object.assign({}, settings, {
              ai: Object.assign({}, settings.ai, { apiKey: settings.ai.apiKey ? "***" : "" }),
            }),
            hasApiKey: !!settings.ai.apiKey,
            presets: ZZ.Ai.PRESETS,
          };
        }

        case "zz:settings:set": {
          const p = msg.payload || {};
          if (p.settings && p.settings.ai && p.settings.ai.apiKey === "***") delete p.settings.ai.apiKey;
          const patch = p.settings || {};
          const needsDnr =
            p.dnr === true ||
            patch.enabled !== undefined ||
            patch.network !== undefined ||
            patch.dnrBudget !== undefined ||
            patch.packs !== undefined;
          await ZZ.Store.saveSettings(patch);
          if (p.rebuild !== false) await ZZ.Main.rebuild({ dnr: needsDnr, refresh: true });
          return { ok: true, settings: ZZ.Store.settings() };
        }

        case "zz:settings:reset": {
          const defaults = JSON.parse(JSON.stringify(ZZ.Store.DEFAULT_SETTINGS));
          defaults.sites = {};
          // 订阅与自定义规则一样属于用户内容，恢复默认时保留
          defaults.subscriptions.items = ((ZZ.Store.settings().subscriptions || {}).items || []).slice();
          await ZZ.Store.saveSettings(defaults);
          await ZZ.Main.rebuild({ dnr: true, refresh: true });
          return { ok: true, settings: ZZ.Store.settings() };
        }

        case "zz:site:set": {
          const p = msg.payload || {};
          const target = p.host || host;
          if (!target) return { ok: false, error: "缺少 host" };
          await ZZ.Store.updateSite(target, {
            enabled: p.enabled,
            profile: p.profile,
            until: p.until,
            clearAuto: !!p.clearAuto,
          });
          ZZ.RuleIndex.build(ZZ.Store.activeRules(), ZZ.Store.settings().packs);
          const eff = ZZ.Store.profileFor(target);
          const targetTab = typeof p.tabId === "number" ? p.tabId : tabId;
          const tab = await getTab(targetTab, sender);
          if (tab && typeof tab.id === "number") {
            await ZZ.Main.injectForTab(tab.id, tab.url);
            ZZ.sendToTab(tab.id, {
              type: eff.profile === "off" ? "zz:site-disabled" : "zz:rules-updated",
              payload: { host: target, reason: "site-set" },
            });
          } else {
            await ZZ.Main.refreshAllTabs();
          }
          return { ok: true, siteEnabled: eff.profile !== "off", profile: eff.profile, profileSource: eff.source, until: eff.until || 0 };
        }

        case "zz:site:temp": {
          const p = msg.payload || {};
          const target = p.host || host;
          if (!target) return { ok: false, error: "缺少 host" };
          const minutes = p.minutes === undefined ? ZZ.Store.settings().tempMinutes || 30 : Number(p.minutes);
          const until = minutes > 0 ? Date.now() + Math.min(minutes, 24 * 60) * 60000 : 0;
          await ZZ.Store.updateSite(target, { until: until || undefined, clearAuto: p.clearAuto !== false });
          ZZ.RuleIndex.build(ZZ.Store.activeRules(), ZZ.Store.settings().packs);
          const targetTab = typeof p.tabId === "number" ? p.tabId : tabId;
          const tab = await getTab(targetTab, sender);
          if (tab && typeof tab.id === "number") {
            await ZZ.Main.injectForTab(tab.id, tab.url);
            ZZ.sendToTab(tab.id, {
              type: until ? "zz:site-disabled" : "zz:rules-updated",
              payload: { host: target, reason: "temporary", until },
            });
          } else {
            await ZZ.Main.refreshAllTabs();
          }
          return { ok: true, until, minutes: until ? Math.round((until - Date.now()) / 60000) : 0 };
        }

        case "zz:antiadblock": {
          const settings = ZZ.Store.settings();
          const p = msg.payload || {};
          const target = p.host || host;
          if (!settings.autoFallback || !target) return { ok: true, action: "none" };
          const eff = ZZ.Store.profileFor(target);
          if (eff.profile === "off") return { ok: true, action: "none" };
          const site = ZZ.Store.siteInfo(target) || {};
          if (eff.profile === "compat" || site.autoCompat) {
            if (!site.until || site.until <= Date.now()) {
              const until = Date.now() + (settings.tempMinutes || 30) * 60000;
              await ZZ.Store.updateSite(target, { until });
              if (tabId) {
                ZZ.sendToTab(tabId, {
                  type: "zz:site-disabled",
                  payload: { host: target, reason: "antiadblock", until },
                });
              }
              return { ok: true, action: "temp-disable", until, minutes: settings.tempMinutes || 30 };
            }
            return { ok: true, action: "already" };
          }
          await ZZ.Store.updateSite(target, {
            profile: "compat",
            autoCompat: { at: Date.now(), reason: p.reason || "anti-adblock", selector: String(p.selector || "").slice(0, 120) },
          });
          if (tabId) {
            ZZ.sendToTab(tabId, { type: "zz:rules-updated", payload: { host: target, reason: "antiadblock" } });
          }
          return { ok: true, action: "compat" };
        }

        case "zz:rules:list": {
          const p = msg.payload || {};
          let rules = ZZ.Store.rules().slice();
          if (p.source && p.source !== "all") rules = rules.filter((r) => r.source === p.source);
          if (p.host) rules = rules.filter((r) => !r.domains.length || r.domains.includes(p.host));
          if (p.query) {
            const q = String(p.query).toLowerCase();
            rules = rules.filter(
              (r) =>
                (r.selector || "").toLowerCase().includes(q) ||
                (r.filter || "").toLowerCase().includes(q) ||
                (r.text || "").toLowerCase().includes(q) ||
                (r.domains || []).join(",").toLowerCase().includes(q) ||
                (r.note || "").toLowerCase().includes(q)
            );
          }
          rules.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          return { ok: true, rules, total: ZZ.Store.rules().length };
        }

        case "zz:rules:add": {
          return importRules((msg.payload && msg.payload.text) || "", {
            source: (msg.payload && msg.payload.source) || "import",
          });
        }

        case "zz:rules:create": {
          const list = (msg.payload && msg.payload.rules) || [];
          const out = [];
          for (const raw of list) {
            const rule = F.normalize(raw, raw.source || "user");
            const err = F.validateRule(rule);
            if (err) return { ok: false, error: err };
            out.push(rule);
          }
          await ZZ.Store.addRules(out);
          await ZZ.Main.rebuild({ dnr: true, refresh: true });
          return { ok: true, added: out.length };
        }

        case "zz:rules:remove": {
          const ids = (msg.payload && msg.payload.ids) || [];
          await ZZ.Store.removeRules(ids);
          await ZZ.Main.rebuild({ dnr: true, refresh: true });
          return { ok: true, removed: ids.length };
        }

        case "zz:rules:update": {
          const p = msg.payload || {};
          await ZZ.Store.updateRule(p.id, p.patch || {});
          await ZZ.Main.rebuild({ dnr: true, refresh: true });
          return { ok: true };
        }

        case "zz:rules:clear": {
          const p = msg.payload || {};
          const keep = p.source ? ZZ.Store.rules().filter((r) => r.source !== p.source) : [];
          await ZZ.Store.saveRules(keep);
          await ZZ.Main.rebuild({ dnr: true, refresh: true });
          return { ok: true };
        }

        case "zz:rules:export": {
          const p = msg.payload || {};
          let rules = ZZ.Store.rules();
          if (p.source && p.source !== "all") rules = rules.filter((r) => r.source === p.source);
          if (p.host) rules = rules.filter((r) => (r.domains || []).includes(p.host));
          if (p.format === "adblock") return { ok: true, text: F.toAdblockText(rules), count: rules.length };
          return {
            ok: true,
            text: JSON.stringify(F.toNative(rules, ZZ.info), null, 2),
            count: rules.length,
          };
        }

        case "zz:packs:list": {
          const idx = ZZ.RuleIndex.stats();
          return {
            ok: true,
            packs: ZZ.RuleIndex.PACKS.map((p) => ({
              id: p.id,
              name: p.name,
              desc: p.desc,
              group: p.group,
              enabled: ZZ.Store.packEnabled(p.id),
            })),
            groups: ZZ.RuleIndex.GROUPS,
            index: idx,
            dnr: ZZ.Dnr.lastResult,
          };
        }

        case "zz:packs:set": {
          const p = msg.payload || {};
          await ZZ.Store.setPack(p.id, p.enabled !== false);
          await ZZ.Main.rebuild({ dnr: true, refresh: true });
          return { ok: true, enabled: ZZ.Store.packEnabled(p.id) };
        }

        case "zz:perms:status": {
          return Object.assign({ ok: true }, await ZZ.Perms.status());
        }

        case "zz:perms:granted": {
          ZZ.Perms.onGranted((msg.payload && msg.payload.permissions) || []);
          return Object.assign({ ok: true }, await ZZ.Perms.status());
        }

        case "zz:perms:remove": {
          const removed = await ZZ.Perms.remove((msg.payload || {}).id);
          return Object.assign({ ok: true, removed }, await ZZ.Perms.status());
        }

        case "zz:subs:list": {
          return {
            ok: true,
            items: ZZ.Subscriptions.list(),
            presets: ZZ.Subscriptions.PRESETS,
            config: ZZ.Subscriptions.config(),
            stats: ZZ.Subscriptions.stats(),
            dnrBudget: ZZ.Store.settings().dnrBudget,
          };
        }

        case "zz:subs:add": {
          const p = msg.payload || {};
          return ZZ.Subscriptions.add(p);
        }

        case "zz:subs:remove": {
          return ZZ.Subscriptions.remove((msg.payload || {}).id);
        }

        case "zz:subs:set": {
          const p = msg.payload || {};
          return ZZ.Subscriptions.setEnabled(p.id, p.enabled !== false);
        }

        case "zz:subs:update": {
          const p = msg.payload || {};
          if (p.id) return ZZ.Subscriptions.update(p.id, { force: p.force !== false, rebuild: true });
          return ZZ.Subscriptions.updateAll({ force: p.force !== false, includeDisabled: !!p.includeDisabled });
        }

        case "zz:subs:config": {
          const p = msg.payload || {};
          if (p.dnrBudget !== undefined) {
            const budget = Math.max(500, Math.min(30000, Number(p.dnrBudget) || 4500));
            await ZZ.Store.saveSettings({ dnrBudget: budget });
            await ZZ.Main.rebuild({ dnr: true, refresh: false });
          }
          const config = await ZZ.Subscriptions.setConfig(p);
          return { ok: true, config, dnrBudget: ZZ.Store.settings().dnrBudget };
        }

        case "zz:ai:test": {
          return ZZ.Ai.test();
        }

        case "zz:ai:classify": {
          const p = msg.payload || {};
          const res = await ZZ.Ai.classify({
            host: p.host,
            url: p.url,
            title: p.title,
            candidates: p.candidates || [],
          });
          if (!res.ok) return res;
          const findings = ZZ.Findings.fromAi(p.host, p.url, p.title, res.findings, { source: "ai" });
          const settings = ZZ.Store.settings();
          const autoApply = settings.ai.autoApply
            ? findings.filter((f) => f.confidence >= (settings.ai.minConfidence || 0.75))
            : [];
          const rules = [];
          for (const f of autoApply) {
            f.status = "applied";
            f.appliedAt = Date.now();
            rules.push.apply(rules, ZZ.Findings.toRules(f, "site"));
          }
          if (rules.length) {
            await ZZ.Store.addRules(F.dedupe(rules));
            await ZZ.Main.rebuild({ dnr: true, refresh: true });
          }
          const pendingFindings = findings.filter((f) => f.status !== "applied");
          const stored = await ZZ.Findings.persist(findings, new Set(autoApply.map((f) => f.fingerprint)));
          if (p.host) {
            await ZZ.Store.setScanCacheEntry(p.host, { findings: stored.length });
          }
          return {
            ok: true,
            findings: stored.map((f) => ({
              id: f.id,
              host: f.host,
              selector: f.selector,
              genericSelector: f.genericSelector,
              category: f.category,
              confidence: f.confidence,
              reason: f.reason,
              blockDomain: f.blockDomain,
              status: f.status,
              sample: f.sample,
            })),
            applied: rules.length,
            pending: pendingFindings.length,
            calls: res.calls,
          };
        }

        case "zz:ai:recognize-tab": {
          const tab = await getTab(msg.payload && msg.payload.tabId, sender);
          if (!tab) return { ok: false, error: "找不到标签页" };
          return Messages.runAiOnTab(tab, { source: "popup" });
        }

        case "zz:ai:highlight": {
          if (tabId) {
            ZZ.call(api.tabs, "sendMessage", tabId, {
              type: "zz:ai:highlight",
              payload: msg.payload || {},
            }).catch(() => {});
          }
          return { ok: true };
        }

        case "zz:scan:start": {
          return ZZ.Scanner.start(msg.payload || {}, null);
        }

        case "zz:scan:stop": {
          return ZZ.Scanner.stop("user");
        }

        case "zz:scan:status": {
          return ZZ.Scanner.status();
        }

        case "zz:autopilot:status": {
          return ZZ.Autopilot.status();
        }

        case "zz:autopilot:run": {
          return ZZ.Autopilot.run({ force: true });
        }

        case "zz:autopilot:stop": {
          return ZZ.Autopilot.stop();
        }

        case "zz:autopilot:history": {
          return ZZ.Autopilot.historySites(msg.payload || {});
        }

        case "zz:learn:list": {
          const list = await ZZ.Learn.all();
          const candidates = await ZZ.Learn.candidates();
          return { ok: true, patterns: list, candidates };
        }

        case "zz:learn:apply": {
          const selector = (msg.payload && msg.payload.selector) || "";
          const F2 = ZZ.RuleFormat;
          if (F2.validateSelector(selector)) return { ok: false, error: "选择器无效" };
          const rule = F2.normalize(
            {
              kind: "cosmetic",
              action: "hide",
              selector,
              domains: [],
              source: "learn",
              note: "自动学习（手动确认）",
            },
            "learn"
          );
          await ZZ.Store.addRules([rule]);
          await ZZ.Learn.markApplied(selector);
          await ZZ.Main.rebuild({ dnr: false, refresh: true });
          return { ok: true };
        }

        case "zz:learn:remove": {
          await ZZ.Learn.remove((msg.payload && msg.payload.selector) || "");
          return { ok: true };
        }

        case "zz:sniff:list": {
          const p = msg.payload || {};
          const target = typeof p.tabId === "number" ? p.tabId : tabId;
          return { ok: true, streams: ZZ.Sniffer.list(target) };
        }

        case "zz:sniff:add": {
          const p = msg.payload || {};
          const target = typeof p.tabId === "number" ? p.tabId : tabId;
          return { ok: true, streams: ZZ.Sniffer.addManual(target, p.url, p.kind) };
        }

        case "zz:sniff:clear": {
          const p = msg.payload || {};
          const target = typeof p.tabId === "number" ? p.tabId : tabId;
          ZZ.Sniffer.clear(target);
          return { ok: true, streams: [] };
        }

        case "zz:reader:toggle": {
          const p = msg.payload || {};
          const target = typeof p.tabId === "number" ? p.tabId : tabId;
          if (!target) return { ok: false, error: "找不到标签页" };
          const res = await ZZ.sendToTab(target, { type: "zz:reader:toggle" });
          return res || { ok: false, error: "内容脚本无响应，请刷新页面" };
        }

        case "zz:clean:set": {
          const p = msg.payload || {};
          const target = typeof p.tabId === "number" ? p.tabId : tabId;
          if (!target) return { ok: false, error: "找不到标签页" };
          const res = await ZZ.sendToTab(target, { type: "zz:clean:toggle", payload: { active: p.active } });
          return res || { ok: false, error: "内容脚本无响应，请刷新页面" };
        }

        case "zz:toolbox:proxy": {
          const p = msg.payload || {};
          if (typeof p.tabId !== "number" || !p.type) return { ok: false, error: "缺少 tabId/type" };
          const res = await ZZ.sendToTab(p.tabId, { type: p.type, payload: p.payload || {} });
          return res || { ok: false, error: "内容脚本无响应，请刷新页面后重试" };
        }

        case "zz:toolbox:context": {          const p = msg.payload || {};
          if (typeof p.tabId === "number") {
            const t = await getTab(p.tabId, sender);
            if (t) return { ok: true, tabId: t.id, title: t.title || "", url: t.url || "" };
          }
          let tabs = [];
          try {
            tabs = (await ZZ.call(api.tabs, "query", { currentWindow: true })) || [];
          } catch (e) {}
          const http = tabs.filter((t) => ZZ.isHttpUrl(t.url || ""));
          const pick = http[http.length - 1] || tabs[tabs.length - 1];
          if (!pick) return { ok: false, error: "找不到可用标签页" };
          return { ok: true, tabId: pick.id, title: pick.title || "", url: pick.url || "" };
        }

        case "zz:toolbox:fetch": {
          const p = msg.payload || {};
          const url = String(p.url || "");
          if (!/^https?:/i.test(url) || url.length > 4000) return { ok: false, error: "无效地址" };
          try {
            const headers = {};
            if (p.referrer && /^https?:/i.test(p.referrer)) {
              headers.Referer = p.referrer;
              try {
                headers.Origin = new URL(p.referrer).origin;
              } catch (e) {}
            }
            const res = await fetch(url, { headers, redirect: "follow" });
            const buf = await res.arrayBuffer();
            if (buf.byteLength > 12 * 1024 * 1024) return { ok: false, error: "分片超过 12MB" };
            if (p.as === "text") {
              return { ok: true, status: res.status, text: new TextDecoder().decode(buf) };
            }
            const bytes = new Uint8Array(buf);
            let bin = "";
            const step = 0x8000;
            for (let i = 0; i < bytes.length; i += step) {
              bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
            }
            return { ok: true, status: res.status, base64: btoa(bin) };
          } catch (e) {
            return { ok: false, error: (e && e.message) || "后台抓取失败" };
          }
        }

        case "zz:toolbox:save-article": {
          const p = msg.payload || {};
          const settings = ZZ.Store.settings();
          const dir = (settings.toolbox && settings.toolbox.articleDir) || "ZeroZen/阅读";
          const safe = String(p.title || "article")
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 100);
          const filename = dir.replace(/\/+$/, "") + "/" + (safe || "article") + ".md";
          const text = "# " + (p.title || "") + "\n\n> 来源：" + (p.url || "") + "\n\n" + String(p.markdown || "");
          const dataUrl = "data:text/markdown;charset=utf-8;base64," + btoa(unescape(encodeURIComponent(text)));
          if (!api.downloads || !api.downloads.download) {
            return { ok: false, error: "需要先授予「下载」权限：打开净化控制台 → 统计与诊断 → 可选权限" };
          }
          try {
            const id = await new Promise((resolve, reject) => {
              api.downloads.download({ url: dataUrl, filename, saveAs: false, conflictAction: "uniquify" }, (downloadId) => {
                const err = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError;
                if (err || downloadId === undefined) reject(new Error((err && err.message) || "download failed"));
                else resolve(downloadId);
              });
            });
            return { ok: true, filename, downloadId: id };
          } catch (e) {
            return { ok: false, error: (e && e.message) || "保存失败" };
          }
        }

        case "zz:bookmarks:preview": {
          return ZZ.Bookmarks.preview(msg.payload && msg.payload.folderId);
        }

        case "zz:findings:list": {
          const p = msg.payload || {};
          let list = ZZ.Store.findings().slice();
          if (p.status && p.status !== "all") list = list.filter((f) => f.status === p.status);
          if (p.host) list = list.filter((f) => f.host === p.host);
          list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          return { ok: true, findings: list, total: ZZ.Store.findings().length };
        }

        case "zz:findings:apply": {
          const p = msg.payload || {};
          const ids = new Set(p.ids || []);
          const list = ZZ.Store.findings().filter((f) => ids.has(f.id));
          const rules = [];
          for (const f of list) {
            rules.push.apply(rules, ZZ.Findings.toRules(f, p.scope === "global" ? "global" : "site"));
            if (ZZ.Learn && p.scope !== "global") {
              await ZZ.Learn.observe(f.host, f.selector, f.genericSelector);
            }
          }
          if (rules.length) {
            await ZZ.Store.addRules(F.dedupe(rules));
            if (ZZ.Learn) {
              for (const f of list) await ZZ.Learn.maybeGeneralize(f.host, f.selector, f.genericSelector);
            }
            await ZZ.Main.rebuild({ dnr: true, refresh: true });
          }
          if (list.length) {
            const now = Date.now();
            const all = ZZ.Store.findings().slice();
            for (const f of all) {
              if (ids.has(f.id)) {
                f.status = "applied";
                f.appliedAt = now;
              }
            }
            await ZZ.Store.saveFindings(all);
          }
          return { ok: true, rules: rules.length };
        }

        case "zz:findings:apply-by-selector": {
          const p = msg.payload || {};
          const targetHost = p.host || host;
          const items = (p.items || []).slice(0, 60);
          const rules = [];
          const selectors = [];
          for (const item of items) {
            const selector = typeof item === "string" ? item : item.selector;
            const err = F.validateSelector(selector);
            if (err) continue;
            selectors.push(F.cleanSelector(selector));
            rules.push(
              F.normalize(
                {
                  kind: "cosmetic",
                  action: "hide",
                  selector,
                  domains: p.scope === "global" ? [] : [targetHost],
                  source: "ai",
                  note: (item && item.reason) || "AI 识别并确认",
                },
                "ai"
              )
            );
          }
          if (!rules.length) return { ok: false, error: "没有有效选择器" };
          await ZZ.Store.addRules(F.dedupe(rules));
          if (ZZ.Learn) {
            for (const item of items) {
              const selector = typeof item === "string" ? item : item.selector;
              await ZZ.Learn.observe(targetHost, selector, (item && item.genericSelector) || selector);
            }
            await ZZ.Learn.maybeGeneralize(targetHost, (items[0] && items[0].selector) || items[0], (items[0] && items[0].genericSelector) || "");
          }
          await ZZ.Main.rebuild({ dnr: true, refresh: true });
          const set = new Set(selectors.map((s) => targetHost + "|" + s));
          const allFindings = ZZ.Store.findings().slice();
          let dirty = false;
          for (const f of allFindings) {
            if (set.has(f.fingerprint) && f.status !== "applied") {
              f.status = "applied";
              f.appliedAt = Date.now();
              dirty = true;
            }
          }
          if (dirty) await ZZ.Store.saveFindings(allFindings);
          if (tabId) {
            ZZ.call(api.tabs, "sendMessage", tabId, {
              type: "zz:ai:highlight-done",
              payload: { count: rules.length },
            }).catch(() => {});
          }
          return { ok: true, applied: rules.length };
        }

        case "zz:findings:add-local": {
          const p = msg.payload || {};
          const found = ZZ.Findings.fromLocal(p.host, p.url, p.title, p.candidates || [], {
            minScore: p.minScore || 55,
          });
          const stored = await ZZ.Findings.persist(found);
          if (p.host) {
            await ZZ.Store.setScanCacheEntry(p.host, { findings: stored.length });
          }
          return {
            ok: true,
            added: stored.length,
            findings: stored.map((f) => ({
              id: f.id,
              host: f.host,
              selector: f.selector,
              genericSelector: f.genericSelector,
              category: f.category,
              confidence: f.confidence,
              reason: f.reason,
              blockDomain: f.blockDomain,
              status: f.status,
              sample: f.sample,
            })),
          };
        }

        case "zz:scan:cache": {
          return { ok: true, cache: ZZ.Store.scanCache() };
        }

        case "zz:stats:reset": {
          await ZZ.Store.resetStats();
          return { ok: true };
        }

        case "zz:findings:dismiss": {
          const ids = new Set((msg.payload && msg.payload.ids) || []);
          const all = ZZ.Store.findings().slice();
          let dirty = false;
          for (const f of all) {
            if (ids.has(f.id) && f.status !== "dismissed") {
              f.status = "dismissed";
              dirty = true;
            }
          }
          if (dirty) await ZZ.Store.saveFindings(all);
          return { ok: true };
        }

        case "zz:findings:remove": {
          await ZZ.Store.removeFindings((msg.payload && msg.payload.ids) || []);
          return { ok: true };
        }

        case "zz:stats:get": {
          const stats = ZZ.Store.stats();
          const entries = Object.keys(stats)
            .map((host) => Object.assign({ host }, stats[host]))
            .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
          return { ok: true, stats: entries, dnr: ZZ.Dnr.lastResult, index: ZZ.RuleIndex.stats() };
        }

        case "zz:picker:start": {
          const tab = await getTab(msg.payload && msg.payload.tabId, sender);
          if (!tab) return { ok: false, error: "找不到标签页" };
          await ZZ.sendToTab(tab.id, { type: "zz:picker:start" });
          return { ok: true };
        }

        case "zz:dnr:sync": {
          return ZZ.Dnr.sync();
        }

        case "zz:diag": {
          const settings = ZZ.Store.settings();
          let usage = null;
          try {
            usage = await ZZ.call(api.storage.local, "getBytesInUse", null);
          } catch (e) {}
          return {
            ok: true,
            browser: ZZ.info,
            index: ZZ.RuleIndex.stats(),
            dnr: ZZ.Dnr.lastResult,
            rules: ZZ.Store.rules().length,
            subs: ZZ.Subscriptions.stats(),
            findings: ZZ.Store.findings().length,
            stats: Object.keys(ZZ.Store.stats()).length,
            usage,
            settings: {
              enabled: settings.enabled,
              cosmetic: settings.cosmetic,
              network: settings.network,
              dnrBudget: settings.dnrBudget,
            },
          };
        }

        case "zz:options:open": {
          await ZZ.call(api.runtime, "openOptionsPage");
          return { ok: true };
        }

        default:
          return { ok: false, error: "unknown message: " + msg.type };
      }
    },

    async runAiOnTab(tab, opts) {
      const host = ZZ.hostOf(tab.url || "");
      if (!host) return { ok: false, error: "无法识别站点" };
      if (!ZZ.Ai.configured()) return { ok: false, error: "请先在控制台配置 AI 接口" };
      const collected = await ZZ.sendToTab(tab.id, {
        type: "zz:scan:collect",
        payload: { deep: true },
      });
      if (!collected || !collected.ok) {
        return { ok: false, error: (collected && collected.error) || "内容脚本无响应，刷新页面后重试" };
      }
      const candidates = (collected.candidates || []).slice(0, ZZ.Store.settings().ai.maxCandidates || 30);
      if (!candidates.length) return { ok: true, findings: [], applied: 0, message: "未发现可疑广告元素" };
      const res = await ZZ.Ai.classify({
        host,
        url: collected.url || tab.url,
        title: collected.title || tab.title,
        candidates,
      });
      if (!res.ok) return { ok: false, error: res.error };
      const findings = ZZ.Findings.fromAi(host, collected.url || tab.url, collected.title, res.findings, {
        source: "ai",
      });
      const settings = ZZ.Store.settings();
      const autoApply = settings.ai.autoApply
        ? findings.filter((f) => f.confidence >= (settings.ai.minConfidence || 0.75))
        : [];
      const rules = [];
      for (const f of autoApply) {
        f.status = "applied";
        rules.push.apply(rules, ZZ.Findings.toRules(f, "site"));
      }
      if (rules.length) {
        await ZZ.Store.addRules(F.dedupe(rules));
        await ZZ.Main.rebuild({ dnr: true, refresh: true });
      }
      const pending = findings.filter((f) => f.status !== "applied");
      if (pending.length) await ZZ.Store.addFindings(pending);
      const selectors = findings.filter((f) => f.status !== "applied").map((f) => f.selector);
      if (selectors.length) {
        ZZ.sendToTab(tab.id, {
          type: "zz:ai:highlight",
          payload: { selectors, persist: true },
        });
      }
      return {
        ok: true,
        host,
        findings: findings.map((f) => ({
          id: f.id,
          selector: f.selector,
          genericSelector: f.genericSelector,
          category: f.category,
          confidence: f.confidence,
          reason: f.reason,
          blockDomain: f.blockDomain,
          status: f.status,
          sample: f.sample,
        })),
        applied: rules.length,
        calls: res.calls,
      };
    },

    listen() {
      api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        let promise;
        try {
          promise = Promise.resolve(Messages.handle(msg, sender));
        } catch (e) {
          sendResponse({ ok: false, error: (e && e.message) || String(e) });
          return false;
        }
        promise
          .then((res) => sendResponse(res === undefined ? { ok: true } : res))
          .catch((e) => {
            ZZ.warn("message error", msg && msg.type, e && e.message);
            sendResponse({ ok: false, error: (e && e.message) || String(e) });
          });
        return true;
      });

      if (api.runtime.onConnect) {
        api.runtime.onConnect.addListener((port) => {
          if (!port || port.name !== "zz-scan") return;
          port.onMessage.addListener(async (msg) => {
            if (!msg || !msg.type) return;
            if (msg.type === "zz:scan:start") {
              const res = await ZZ.Scanner.start(msg.payload || {}, port);
              if (!res.ok) {
                try {
                  port.postMessage({ type: "zz:scan:done", payload: { error: res.error, cancelled: true } });
                } catch (e) {}
              }
            } else if (msg.type === "zz:scan:stop") {
              ZZ.Scanner.stop("user");
            } else if (msg.type === "zz:scan:status") {
              try {
                port.postMessage({ type: "zz:scan:status", payload: ZZ.Scanner.status() });
              } catch (e) {}
            }
          });
        });
      }
    },
  };

  async function getTab(tabId, sender) {
    if (typeof tabId === "number") {
      try {
        return await ZZ.call(api.tabs, "get", tabId);
      } catch (e) {
        return null;
      }
    }
    if (sender && sender.tab) return sender.tab;
    try {
      const tabs = await ZZ.call(api.tabs, "query", { active: true, currentWindow: true });
      return tabs && tabs[0];
    } catch (e) {
      return null;
    }
  }

  ZZ.Messages = Messages;
})();

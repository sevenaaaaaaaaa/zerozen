(function () {
  const ZZ = globalThis.ZZ;
  const api = ZZ.browser;

  const Dnr = {
    lastResult: { applied: 0, dropped: 0, total: 0, at: 0, error: null, supported: true },

    supported() {
      return !!(api.declarativeNetRequest && api.declarativeNetRequest.updateDynamicRules);
    },

    async existingIds() {
      try {
        const rules = await ZZ.call(api.declarativeNetRequest, "getDynamicRules");
        return (rules || []).map((r) => r.id);
      } catch (e) {
        return [];
      }
    },

    async apply(addRules, removeRuleIds) {
      await ZZ.call(api.declarativeNetRequest, "updateDynamicRules", { removeRuleIds, addRules });
    },

    async sync() {
      if (!Dnr.supported()) {
        Dnr.lastResult = {
          applied: 0,
          dropped: 0,
          total: 0,
          at: Date.now(),
          error: ZZ.T("declarativeNetRequest 不可用"),
          supported: false,
        };
        return Dnr.lastResult;
      }
      const settings = ZZ.Store.settings();
      let removeRuleIds = await Dnr.existingIds();
      if (!settings.enabled || !settings.network) {
        try {
          await Dnr.apply([], removeRuleIds);
        } catch (e) {}
        Dnr.lastResult = { applied: 0, dropped: 0, total: 0, at: Date.now(), error: null, supported: true };
        return Dnr.lastResult;
      }
      const compiled = ZZ.RuleIndex.compileDNR(settings.dnrBudget);
      let error = null;
      let applied = 0;
      const withoutRegex = compiled.rules.filter((r) => !r.condition.regexFilter);
      const attempts = [
        compiled.rules,
        withoutRegex.length !== compiled.rules.length ? withoutRegex : null,
        withoutRegex.slice(0, Math.max(1, Math.floor(withoutRegex.length / 2))),
        [],
      ].filter(Boolean);
      for (let i = 0; i < attempts.length; i++) {
        const candidate = attempts[i];
        try {
          await Dnr.apply(candidate, removeRuleIds);
          applied = candidate.length;
          if (i > 0) {
            error =
              ZZ.T("已降级应用 $1 条规则", applied) +
              (i === 1 ? ZZ.T("（部分浏览器不支持正则规则）") : ZZ.T("（规则过多，已截断）"));
          }
          break;
        } catch (e) {
          error = e && e.message ? e.message : String(e);
          removeRuleIds = await Dnr.existingIds();
          applied = 0;
        }
      }
      Dnr.lastResult = {
        applied,
        dropped: compiled.dropped.length + (compiled.rules.length - applied),
        total: compiled.total,
        at: Date.now(),
        error,
        supported: true,
        allow: compiled.rules.filter((r) => r.action.type === "allow").length,
      };
      ZZ.log("DNR sync", Dnr.lastResult);
      return Dnr.lastResult;
    },
  };

  ZZ.Dnr = Dnr;
})();

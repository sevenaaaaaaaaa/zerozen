(function () {
  const ZZ = globalThis.ZZ;
  const F = {};

  const RESOURCE_MAP = {
    script: "script",
    image: "image",
    stylesheet: "stylesheet",
    object: "object",
    "object-subrequest": "object",
    xmlhttprequest: "xmlhttprequest",
    xhr: "xmlhttprequest",
    subdocument: "sub_frame",
    "sub-frame": "sub_frame",
    frame: "sub_frame",
    media: "media",
    font: "font",
    ping: "ping",
    beacon: "ping",
    other: "other",
    websocket: "websocket",
    csp_report: "csp_report",
  };

  const DEFAULT_RESOURCE_TYPES = [
    "script",
    "image",
    "xmlhttprequest",
    "sub_frame",
    "media",
    "stylesheet",
    "font",
    "object",
    "ping",
    "other",
  ];

  const UNSAFE_SELECTOR = /[{}\@;]|url\s*\(/i;

  F.DEFAULT_RESOURCE_TYPES = DEFAULT_RESOURCE_TYPES;

  F.cleanSelector = function (sel) {
    return String(sel || "")
      .replace(/\s+/g, " ")
      .trim();
  };

  F.validateSelector = function (sel, opts) {
    const s = F.cleanSelector(sel);
    if (!s) return "empty selector";
    if (s.length > 400) return "selector too long";
    if (UNSAFE_SELECTOR.test(s)) return "selector contains unsafe characters";
    const withoutAttrs = s.replace(/\[[^\]]*\]/g, "");
    if (withoutAttrs.includes("|")) return "selector contains invalid namespace pipe";
    const compact = s.toLowerCase();
    if (/^(\*|html|body|:root)(\s*[>+~]\s*\*)?$/.test(compact)) return "selector too broad";
    if (/^(\*|html|body|:root)(\s|[>+~])/.test(compact)) return "selector too broad";
    if (opts && opts.allowRoot) return null;
    if (/^[a-z][a-z0-9]*$/.test(compact) && !["iframe", "ins", "embed", "object"].includes(compact)) {
      return "bare tag selector too broad";
    }
    if ((compact.match(/>/g) || []).length > 6) return "selector too deep";
    return null;
  };

  F.normalizeDomain = function (d) {
    return String(d || "")
      .trim()
      .toLowerCase()
      .replace(/^~/, "")
      .replace(/^\*?\.?/, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "");
  };

  F.ruleDomainMatch = function (host, domain) {
    const h = String(host || "").toLowerCase();
    const d = F.normalizeDomain(domain);
    if (!d || d === "*") return true;
    return h === d || h.endsWith("." + d);
  };

  F.normalize = function (rule, source) {
    if (!rule || typeof rule !== "object") return null;
    const out = Object.assign({}, rule);
    if (typeof out.domains === "string") out.domains = out.domains.split(",");
    if (typeof out.excludeDomains === "string") out.excludeDomains = out.excludeDomains.split(",");
    out.kind = out.kind || (out.selector ? "cosmetic" : "network");
    if (out.kind === "cosmetic") {
      if (out.action !== "remove" && out.action !== "allow") out.action = "hide";
      out.selector = F.cleanSelector(out.selector);
    } else if (out.kind === "text") {
      if (out.action !== "remove") out.action = "hide";
      out.text = String(out.text || "").trim();
      if (out.tag) out.tag = String(out.tag).toLowerCase();
    } else {
      out.kind = "network";
      if (out.action !== "allow") out.action = "block";
      out.filter = String(out.filter || "").trim();
      if (out.regexFilter) out.regexFilter = String(out.regexFilter).trim();
      out.resourceTypes =
        Array.isArray(out.resourceTypes) && out.resourceTypes.length
          ? out.resourceTypes.filter((t) => t !== "main_frame")
          : DEFAULT_RESOURCE_TYPES.slice();
      if (out.thirdParty === true) out.domainType = "thirdParty";
      else if (out.thirdParty === false) out.domainType = "firstParty";
    }
    out.domains = Array.isArray(out.domains)
      ? out.domains.map(F.normalizeDomain).filter(Boolean)
      : [];
    out.excludeDomains = Array.isArray(out.excludeDomains)
      ? out.excludeDomains.map(F.normalizeDomain).filter(Boolean)
      : [];
    out.enabled = out.enabled !== false;
    out.source = out.source || source || "user";
    out.createdAt = out.createdAt || Date.now();
    out.id = out.id || ZZ.uid("r");
    return out;
  };

  F.canonicalKey = function (rule) {
    const parts = [
      rule.kind,
      rule.action,
      rule.selector || "",
      rule.filter || rule.regexFilter || "",
      rule.text || "",
      rule.tag || "",
      (rule.domains || []).slice().sort().join(","),
      (rule.excludeDomains || []).slice().sort().join(","),
      rule.domainType || "",
      (rule.resourceTypes || []).slice().sort().join(","),
    ];
    return parts.join("|");
  };

  F.validateRule = function (rule) {
    if (!rule) return "empty rule";
    if (rule.kind === "cosmetic") {
      const err = F.validateSelector(rule.selector);
      if (err) return err;
    } else if (rule.kind === "text") {
      if (!rule.text) return "empty text";
      if (rule.text.length > 40) return "text too long";
    } else {
      const filter = rule.filter || rule.regexFilter;
      if (!filter) return "missing url filter";
      if (rule.regexFilter) {
        if (!/^\/.*\/$/.test(rule.regexFilter)) return "regexFilter must be wrapped in slashes";
      } else {
        if (filter.length > 2000) return "filter too long";
        if (/[^\x20-\x7e]/.test(filter)) return "filter must be ascii";
        if (/\s/.test(filter)) return "filter must not contain spaces";
        if (/^\*+$/.test(filter)) return "filter too broad";
      }
    }
    return null;
  };

  F.parseAdblockFilter = function (raw) {
    let filter = raw;
    let isAllow = false;
    if (filter.startsWith("@@")) {
      isAllow = true;
      filter = filter.slice(2);
    }
    let opts = [];
    if (!/^\/.*\/$/.test(filter)) {
      const dollar = filter.lastIndexOf("$");
      if (dollar > 0) {
        opts = filter
          .slice(dollar + 1)
          .split(",")
          .filter(Boolean);
        filter = filter.slice(0, dollar);
      }
    }
    if (!filter) return null;
    const unsupported = [];
    const out = { filter, opts, isAllow, skipped: unsupported };
    for (const opt of opts) {
      const name = opt.replace(/^~/, "").trim().toLowerCase();
      if (name.startsWith("domain=")) continue;
      if (name === "third-party" || name === "3p") continue;
      if (name === "important") continue;
      if (RESOURCE_MAP[name] || name === "document" || name === "popup" || name === "genericblock") {
        if (name === "document") unsupported.push("document");
        else if (name === "popup" || name === "genericblock") unsupported.push(name);
        continue;
      }
      unsupported.push(name);
    }
    return out;
  };

  F.parseAdblockOptionDomains = function (opt) {
    const value = opt.slice(opt.indexOf("=") + 1);
    const include = [];
    const exclude = [];
    for (const part of value.split("|")) {
      if (!part) continue;
      if (part.startsWith("~")) exclude.push(F.normalizeDomain(part));
      else if (part.includes("*")) continue;
      else include.push(F.normalizeDomain(part));
    }
    return { include, exclude };
  };

  F.parseAdblockText = function (text, opts) {
    const source = (opts && opts.source) || "import";
    const network = [];
    const cosmetic = [];
    const skipped = [];
    const lines = String(text || "").split(/\r?\n/);

    function domainScope(domainsPart) {
      const include = [];
      const exclude = [];
      let invalid = false;
      for (const part of String(domainsPart || "").split(",")) {
        const d = part.trim();
        if (!d) continue;
        if (d.includes("*") || d.includes("/")) {
          invalid = true;
          continue;
        }
        if (d.startsWith("~")) exclude.push(F.normalizeDomain(d));
        else include.push(F.normalizeDomain(d));
      }
      return { include: include.filter(Boolean), exclude: exclude.filter(Boolean), invalid };
    }

    lines.forEach((line, idx) => {
      const raw = line.trim();
      if (!raw) return;
      if (raw.startsWith("!")) return;
      if (raw.startsWith("[")) return;

      if (raw.includes("#@#")) {
        const [domainsPart, selector] = raw.split("#@#");
        const scope = domainScope(domainsPart);
        if (scope.invalid) {
          skipped.push({ line: idx + 1, text: raw, reason: "entity domain unsupported" });
          return;
        }
        const rule = F.normalize(
          { kind: "cosmetic", action: "allow", selector, domains: scope.include, excludeDomains: scope.exclude },
          source
        );
        const err = F.validateRule(rule);
        if (err) skipped.push({ line: idx + 1, text: raw, reason: err });
        else cosmetic.push(rule);
        return;
      }
      if (raw.includes("##") || raw.includes("#?#") || raw.includes("#$#")) {
        if (!raw.includes("##")) {
          skipped.push({ line: idx + 1, text: raw, reason: "extended cosmetic syntax unsupported" });
          return;
        }
        const [domainsPart, selector] = raw.split("##");
        if (domainsPart.includes("#")) return;
        const scope = domainScope(domainsPart);
        if (scope.invalid) {
          skipped.push({ line: idx + 1, text: raw, reason: "entity domain unsupported" });
          return;
        }
        const rule = F.normalize(
          { kind: "cosmetic", action: "hide", selector, domains: scope.include, excludeDomains: scope.exclude },
          source
        );
        const err = F.validateRule(rule);
        if (err) skipped.push({ line: idx + 1, text: raw, reason: err });
        else cosmetic.push(rule);
        return;
      }

      const parsed = F.parseAdblockFilter(raw);
      if (!parsed) return;
      if (parsed.skipped.length) {
        skipped.push({
          line: idx + 1,
          text: raw,
          reason: "unsupported option: " + parsed.skipped.join(","),
        });
        return;
      }
      const rule = {
        kind: "network",
        action: parsed.isAllow ? "allow" : "block",
        filter: parsed.filter,
        domains: [],
        excludeDomains: [],
        resourceTypes: [],
        source,
      };
      if (/^\/.*\/$/.test(parsed.filter) && parsed.filter.length > 2) {
        rule.regexFilter = parsed.filter;
        rule.filter = "";
      }
      for (const opt of parsed.opts) {
        const bare = opt.replace(/^~/, "").toLowerCase();
        if (bare === "third-party") rule.thirdParty = !opt.startsWith("~");
        else if (bare.startsWith("domain=")) {
          const d = F.parseAdblockOptionDomains(opt);
          rule.domains = d.include;
          rule.excludeDomains = d.exclude;
        } else if (bare === "important") rule.priority = 105;
        else if (RESOURCE_MAP[bare]) rule.resourceTypes.push(RESOURCE_MAP[bare]);
        else if (bare === "document" || bare === "popup") {
          skipped.push({ line: idx + 1, text: raw, reason: "unsupported option: " + bare });
          return;
        }
      }
      const normalized = F.normalize(rule, source);
      const err = F.validateRule(normalized);
      if (err) skipped.push({ line: idx + 1, text: raw, reason: err });
      else network.push(normalized);
    });
    return { rules: network.concat(cosmetic), network, cosmetic, skipped };
  };

  F.toAdblockText = function (rules, opts) {
    const lines = [
      "! ZeroZen export - " + new Date().toISOString(),
      ZZ.T("! 格式：Adblock 语法（子集）。网络规则 + 外观规则。"),
    ];
    for (const r of rules || []) {
      if (!r || r.enabled === false) continue;
      if (r.kind === "network") {
        const prefix = r.action === "allow" ? "@@" : "";
        const opts = [];
        if (r.thirdParty === true) opts.push("third-party");
        if (r.thirdParty === false) opts.push("~third-party");
        if (Array.isArray(r.resourceTypes) && r.resourceTypes.length) {
          const names = r.resourceTypes.map((t) => (t === "sub_frame" ? "subdocument" : t));
          opts.push.apply(opts, names);
        }
        const domainParts = (r.domains || []).concat((r.excludeDomains || []).map((d) => "~" + d));
        if (domainParts.length) opts.push("domain=" + domainParts.join("|"));
        lines.push(prefix + (r.regexFilter || r.filter) + (opts.length ? "$" + opts.join(",") : ""));
      } else if (r.kind === "cosmetic") {
        const domains = (r.domains || []).join(",");
        lines.push(domains + (r.action === "allow" ? "#@#" : "##") + r.selector);
      }
    }
    return lines.join("\n") + "\n";
  };

  F.parseNative = function (input) {
    let data = input;
    if (typeof input === "string") {
      try {
        data = JSON.parse(input);
      } catch (e) {
        return { rules: [], error: ZZ.T("JSON 解析失败：$1", e.message) };
      }
    }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.rules) ? data.rules : null;
    if (!list) return { rules: [], error: ZZ.T("未找到 rules 数组") };
    const rules = [];
    const skipped = [];
    list.forEach((raw, i) => {
      const rule = F.normalize(Object.assign({}, raw, { source: raw.source || "import" }), "import");
      const err = F.validateRule(rule);
      if (err) skipped.push({ line: i + 1, text: (raw && (raw.selector || raw.filter)) || "", reason: err });
      else rules.push(rule);
    });
    return { rules, skipped };
  };

  F.toNative = function (rules, meta) {
    return {
      format: "zerozen-rules",
      version: 1,
      exportedAt: new Date().toISOString(),
      generator: "ZeroZen " + ((meta && meta.version) || "0.1.0"),
      rules: rules || [],
    };
  };

  F.dedupe = function (rules) {
    const seen = new Map();
    for (const rule of rules || []) {
      if (!rule) continue;
      const key = F.canonicalKey(rule);
      if (!seen.has(key)) seen.set(key, rule);
    }
    return Array.from(seen.values());
  };

  F.parseFilterList = function (text, source) {
    const byCanonical = new Map();
    const out = [];
    const skipped = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const raw = line.trim();
      if (!raw || raw.startsWith("#") || raw.startsWith(";") || raw.startsWith("//")) continue;
      const rule = F.normalize({ kind: "network", action: "block", filter: raw, source: source || "import" }, source);
      const err = F.validateRule(rule);
      if (err) {
        skipped.push({ text: raw, reason: err });
        continue;
      }
      const key = F.canonicalKey(rule);
      if (byCanonical.has(key)) continue;
      byCanonical.set(key, rule);
      out.push(rule);
    }
    return { rules: out, skipped };
  };

  ZZ.RuleFormat = F;
})();

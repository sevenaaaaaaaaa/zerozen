#!/usr/bin/env node
/**
 * 从开源过滤列表合并生成 rules/pack-oss.json
 *
 * 用法: npm run import:lists
 *
 * 处理流程:
 *   1. 下载 EasyList / EasyPrivacy / EasyList China / AdGuard / uBlock / CJX / 1Hosts / Peter Lowe
 *   2. 解析为 ZeroZen 原生规则，过滤不安全或过宽的选择器（与 validate-rules 同一套校验）
 *   3. 与内置规则包去重，并把多列表重复的域名/选择器合并计数
 *   4. 按覆盖来源数排序，截取预算内的规则，写入 rules/pack-oss.json
 *   5. 生成 docs/oss-sources.md 记录来源、许可证与保留数量
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox, load, ROOT } from "./harness.mjs";
import { checkCosmeticSelector } from "./rule-guard.mjs";

const NETWORK_CAP = 3200;
const COSMETIC_TOTAL_CAP = 2600;
const COSMETIC_PER_DOMAIN_CAP = 60;

const SOURCES = [
  {
    id: "easylist",
    name: "EasyList",
    urls: ["https://easylist.to/easylist/easylist.txt"],
    license: "GPLv3 / CC BY-SA 3.0",
  },
  {
    id: "easyprivacy",
    name: "EasyPrivacy",
    urls: [
      "https://easylist.to/easylist/easyprivacy.txt",
      "https://easylist-downloads.adblockplus.org/easyprivacy.txt",
    ],
    license: "GPLv3 / CC BY-SA 3.0",
  },
  {
    id: "easylist-china",
    name: "EasyList China",
    urls: [
      "https://easylist-downloads.adblockplus.org/easylistchina.txt",
      "https://cdn.jsdelivr.net/gh/easylist/easylistchina@master/easylistchina.txt",
    ],
    license: "GPLv3 / CC BY-SA 3.0",
  },
  {
    id: "adguard-base",
    name: "AdGuard Base filter",
    urls: ["https://filters.adtidy.org/extension/ublock/filters/2.txt"],
    license: "GPLv3",
  },
  {
    id: "adguard-cn",
    name: "AdGuard Chinese filter",
    urls: ["https://filters.adtidy.org/extension/ublock/filters/224.txt"],
    license: "GPLv3",
  },
  {
    id: "ublock-filters",
    name: "uBlock Origin filters (uAssets)",
    urls: ["https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssets@master/filters/filters.txt"],
    license: "GPLv3",
  },
  {
    id: "cjx-annoyance",
    name: "CJX's Annoyance List",
    urls: ["https://cdn.jsdelivr.net/gh/cjx82630/cjxlist@master/cjx-annoyance.txt"],
    license: "GPLv3",
  },
  {
    id: "1hosts-lite",
    name: "1Hosts (Lite)",
    urls: ["https://cdn.jsdelivr.net/gh/badmojr/1Hosts@master/Lite/adblock.txt"],
    license: "MPL-2.0",
  },
  {
    id: "peter-lowe",
    name: "Peter Lowe's Ad and tracking server list",
    urls: ["https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0"],
    license: "免费个人使用（见 pgl.yoyo.org）",
  },
];

const sandbox = makeSandbox();
load(sandbox, "background/lib-compat.js", "background/rule-format.js");
const F = sandbox.ZZ.RuleFormat;

const PURE_DOMAIN = /^\|\|([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\^$/i;

function builtinSets() {
  const keys = new Set();
  const networkHosts = new Set();
  for (const file of readdirSync(join(ROOT, "rules"))) {
    if (!file.endsWith(".json") || file === "pack-oss.json") continue;
    const data = JSON.parse(readFileSync(join(ROOT, "rules", file), "utf8"));
    for (const raw of data.rules || []) {
      const rule = F.normalize(Object.assign({}, raw, { source: "builtin" }), "builtin");
      if (!rule) continue;
      keys.add(F.canonicalKey(rule));
      if (rule.kind === "network" && rule.filter) {
        const m = PURE_DOMAIN.exec(String(rule.filter).trim());
        if (m) networkHosts.add(m[1].toLowerCase());
      }
    }
  }
  return { keys, networkHosts };
}

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "user-agent": "ZeroZen-rule-import/1.0 (+local)" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("fetch failed");
}

async function fetchWithFallback(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      return await fetchText(url);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("fetch failed");
}

async function main() {
  const builtin = builtinSets();
  console.log(`builtin: ${builtin.keys.size} rules, ${builtin.networkHosts.size} network hosts`);

  const network = new Map(); // domain -> { sources:Set }
  const cosmetic = new Map(); // domain -> Map(selector -> { sources:Set })
  const perSource = [];

  for (const src of SOURCES) {
    const item = { id: src.id, name: src.name, url: (src.urls || [src.url]).join(" , "), license: src.license, parsed: 0, keptNetwork: 0, keptCosmetic: 0, error: "" };
    try {
      const text = await fetchWithFallback(src.urls || [src.url]);
      const parsed = F.parseAdblockText(text, { source: "import" });
      item.parsed = (parsed.rules || []).length;
      for (const rule of parsed.rules || []) {
        if (rule.kind === "network") {
          if (rule.action !== "block") continue;
          const m = PURE_DOMAIN.exec(String(rule.filter || "").trim());
          if (!m) continue;
          const domain = m[1].toLowerCase();
          if (builtin.networkHosts.has(domain)) continue;
          const cur = network.get(domain) || { sources: new Set() };
          cur.sources.add(src.id);
          network.set(domain, cur);
          item.keptNetwork++;
          continue;
        }
        if (rule.kind === "cosmetic") {
          if (rule.action !== "hide") continue;
          const domains = (rule.domains || []).map((d) => F.normalizeDomain(d)).filter(Boolean);
          if (!domains.length) continue;
          const selector = rule.selector;
          if (checkCosmeticSelector(selector)) continue;
          let kept = false;
          for (const domain of domains) {
            const key = F.canonicalKey(F.normalize({ kind: "cosmetic", action: "hide", selector, domains: [domain] }, "import"));
            if (builtin.keys.has(key)) continue;
            if (!cosmetic.has(domain)) cosmetic.set(domain, new Map());
            const map = cosmetic.get(domain);
            const cur = map.get(selector) || { sources: new Set() };
            cur.sources.add(src.id);
            map.set(selector, cur);
            kept = true;
          }
          if (kept) item.keptCosmetic++;
        }
      }
      console.log(`  ${src.id.padEnd(16)} parsed=${String(item.parsed).padStart(6)} network=${String(item.keptNetwork).padStart(5)} cosmetic=${String(item.keptCosmetic).padStart(5)}`);
    } catch (e) {
      item.error = (e && e.message) || String(e);
      console.log(`  ${src.id.padEnd(16)} ERROR ${item.error}`);
    }
    perSource.push(item);
  }

  const networkRules = [...network.entries()]
    .sort((a, b) => b[1].sources.size - a[1].sources.size || a[0].length - b[0].length)
    .slice(0, NETWORK_CAP)
    .map(([domain]) => ({
      kind: "network",
      action: "block",
      filter: "||" + domain + "^",
      note: "开源列表合并",
    }));

  const cosmeticRules = [];
  const domainEntries = [...cosmetic.entries()];
  const flat = [];
  for (const [domain, map] of domainEntries) {
    const selectors = [...map.entries()]
      .sort((a, b) => b[1].sources.size - a[1].sources.size || a[0].length - b[0].length)
      .slice(0, COSMETIC_PER_DOMAIN_CAP);
    for (const [selector] of selectors) flat.push({ domain, selector, hits: map.get(selector).sources.size });
  }
  flat.sort((a, b) => b.hits - a.hits || a.selector.length - b.selector.length);
  for (const item of flat.slice(0, COSMETIC_TOTAL_CAP)) {
    cosmeticRules.push({
      kind: "cosmetic",
      action: "hide",
      selector: item.selector,
      domains: [item.domain],
      note: "开源列表合并",
    });
  }

  const rules = networkRules.concat(cosmeticRules);
  const out = {
    id: "oss",
    name: "开源合并规则",
    desc: "EasyList / EasyPrivacy / AdGuard / uBlock / CJX / 1Hosts / Peter Lowe 去重合并（见 docs/oss-sources.md）",
    rules,
  };
  writeFileSync(join(ROOT, "rules", "pack-oss.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`\npack-oss.json: ${networkRules.length} network + ${cosmeticRules.length} cosmetic = ${rules.length} rules`);

  const now = new Date().toISOString().slice(0, 10);
  const lines = [
    "# 开源规则来源",
    "",
    `生成时间：${now}（\`npm run import:lists\` 可重新生成）`,
    "",
    "| 来源 | 许可证 | 解析 | 保留域名规则 | 保留外观规则 |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const s of perSource) {
    lines.push(`| ${s.name} | ${s.license} | ${s.error ? "失败：" + s.error : s.parsed} | ${s.keptNetwork} | ${s.keptCosmetic} |`);
  }
  lines.push(
    "",
    "合并结果：`rules/pack-oss.json`（网络 " + networkRules.length + " 条 / 外观 " + cosmeticRules.length + " 条）。",
    "",
    "说明：",
    "- 只合并纯域名拦截规则（`||domain^`）与站点级外观规则，避免误伤与预算膨胀；",
    "- 与内置 34 个规则包做了去重，且所有选择器都通过 `scripts/rule-guard.mjs` 的安全校验；",
    "- 列表内容遵循各自许可证，本扩展仅做格式转换、去重与截断；如需转载，请保留上表来源与许可证信息。"
  );
  writeFileSync(join(ROOT, "docs", "oss-sources.md"), lines.join("\n") + "\n");
  console.log("docs/oss-sources.md written");
}

main().catch((e) => {
  console.error("import-lists failed:", e && e.stack ? e.stack : e);
  process.exit(1);
});

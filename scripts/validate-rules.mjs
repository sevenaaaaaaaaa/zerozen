#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox, loadRuleEngine, ROOT, assert, assertEqual } from "./harness.mjs";
import { checkCosmeticSelector } from "./rule-guard.mjs";

const PACK_DIR = join(ROOT, "rules");

const files = readdirSync(PACK_DIR).filter((f) => f.endsWith(".json"));
console.log(`rules: ${files.length} pack files`);

const packs = [];
let ruleCount = 0;
let errors = 0;
const canonical = new Map();
const byFile = new Map();

for (const file of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(PACK_DIR, file), "utf8"));
  } catch (e) {
    console.error(`FAIL ${file}: invalid JSON - ${e.message}`);
    errors++;
    continue;
  }
  if (!data.id || !data.name) {
    console.error(`FAIL ${file}: missing id/name`);
    errors++;
    continue;
  }
  byFile.set(file, data.id);
  if (!Array.isArray(data.rules) || !data.rules.length) {
    console.error(`FAIL ${file}: no rules`);
    errors++;
    continue;
  }
  const kinds = { network: 0, cosmetic: 0, text: 0 };
  for (const [i, rule] of data.rules.entries()) {
    ruleCount++;
    const where = `${file}#${i}`;
    if (!rule.kind || !["network", "cosmetic", "text"].includes(rule.kind)) {
      console.error(`FAIL ${where}: bad kind ${rule.kind}`);
      errors++;
      continue;
    }
    if (!rule.action || !["block", "allow", "hide", "remove"].includes(rule.action)) {
      console.error(`FAIL ${where}: bad action ${rule.action}`);
      errors++;
      continue;
    }
    if (rule.kind === "cosmetic") {
      const sel = String(rule.selector || "");
      const problem = checkCosmeticSelector(sel);
      if (problem) {
        console.error(`FAIL ${where}: ${problem} ${sel}`);
        errors++;
        continue;
      }
    } else if (rule.kind === "network") {
      const f = String(rule.filter || "");
      if (!f) {
        console.error(`FAIL ${where}: empty filter`);
        errors++;
        continue;
      }
      if (/[^\x20-\x7e]/.test(f)) {
        console.error(`FAIL ${where}: non-ascii filter ${f}`);
        errors++;
        continue;
      }
      if (/^\*+$/.test(f) || f === "^" || f === "||") {
        console.error(`FAIL ${where}: too broad filter ${f}`);
        errors++;
        continue;
      }
      if (!/^(\|\||\||[a-z0-9])/.test(f) && !f.startsWith("/")) {
        console.error(`FAIL ${where}: suspicious filter ${f}`);
        errors++;
        continue;
      }
    } else {
      if (!rule.text || String(rule.text).length > 30) {
        console.error(`FAIL ${where}: bad text rule`);
        errors++;
        continue;
      }
    }
    if (rule.domains && !Array.isArray(rule.domains)) {
      console.error(`FAIL ${where}: domains must be array`);
      errors++;
      continue;
    }
    const actionKey = rule.kind === "network" ? rule.filter : rule.kind === "text" ? "text:" + rule.text : rule.selector;
    const key = [rule.kind, rule.action, actionKey, (rule.domains || []).join(",")].join("|");
    if (canonical.has(key)) console.log(`  info cross-pack duplicate (deduped at runtime): ${where} == ${canonical.get(key)}`);
    else canonical.set(key, where);
    kinds[rule.kind]++;
  }
  packs.push({ id: data.id, rules: data.rules.length, ...kinds });
}

console.log("\npacks:");
for (const p of packs) {
  console.log(
    `  ${p.id.padEnd(12)} rules=${String(p.rules).padStart(3)}  network=${String(p.network).padStart(3)}  cosmetic=${String(p.cosmetic).padStart(3)}  text=${p.text}`
  );
}
console.log(`\ntotal rules: ${ruleCount}`);

// 用磁盘上的规则包模拟扩展内的 fetch，下面的 loadPacks 才会真正读到文件
const sandbox = makeSandbox({
  fetch: async (url) => {
    const rel = String(url).replace("chrome-extension://test/", "");
    return { json: async () => JSON.parse(readFileSync(join(ROOT, rel), "utf8")) };
  },
});
loadRuleEngine(sandbox);
const ZZ = sandbox.ZZ;
const F = ZZ.RuleFormat;

// 注册一致性：磁盘上的包必须挂进 RuleIndex.PACKS，否则校验能过、运行时却永远不加载
// （0.9.x 的 pack-antifraud / pack-piracy-tv 就是这样漏掉的）
const registered = new Map(ZZ.RuleIndex.PACKS.map((p) => [p.id, p.file.replace(/^rules\//, "")]));
assertEqual(
  [...byFile.entries()].filter(([, id]) => !registered.has(id)).map(([f]) => f),
  [],
  "every pack file is registered in RuleIndex.PACKS"
);
assertEqual(
  ZZ.RuleIndex.PACKS.filter((p) => !byFile.has(p.file.replace(/^rules\//, ""))).map((p) => p.id),
  [],
  "every registered pack has a pack file"
);
assertEqual(
  ZZ.RuleIndex.PACKS.filter((p) => byFile.get(p.file.replace(/^rules\//, "")) !== p.id).map((p) => p.id),
  [],
  "pack registry id matches file id"
);
assertEqual(
  ZZ.RuleIndex.PACKS.filter((p) => !ZZ.RuleIndex.GROUPS.some((g) => g.id === p.group)).map((p) => p.id),
  [],
  "every pack belongs to a known group"
);

const allRules = [];
for (const file of files) {
  const data = JSON.parse(readFileSync(join(PACK_DIR, file), "utf8"));
  data.rules.forEach((raw, i) => {
    const rule = F.normalize(
      Object.assign({}, raw, { id: "b:" + data.id + ":" + i, pack: data.id, source: "builtin" }),
      "builtin"
    );
    const err = F.validateRule(rule);
    if (err) {
      console.error(`FAIL ${data.id}#${i}: validateRule -> ${err}`);
      errors++;
    }
    allRules.push(rule);
  });
}

console.log("\nengine:");
const idx = ZZ.RuleIndex.build(allRules, null);
const stats = ZZ.RuleIndex.stats();
console.log("  index stats:", JSON.stringify(stats));
assert(stats.cosmetic > 0, "cosmetic index built");
assert(stats.network > 0, "network index built");
assert(stats.invalid === 0, "no rules dropped by engine");

const compiled = ZZ.RuleIndex.compileDNR(4500);
console.log(`  dnr: compiled=${compiled.rules.length} dropped=${compiled.dropped.length}`);
assert(compiled.dropped.length === 0, "all network rules fit in DNR budget");
assertEqual(
  compiled.rules.every((r) => r.condition && (r.condition.urlFilter || r.condition.regexFilter)),
  true,
  "every dnr rule has a filter"
);
assertEqual(
  compiled.rules.every((r) => !(r.condition.resourceTypes || []).includes("main_frame")),
  true,
  "no block rule applies to main_frame"
);
const ids = new Set(compiled.rules.map((r) => r.id));
assertEqual(ids.size, compiled.rules.length, "dnr rule ids unique");

const payload = ZZ.RuleIndex.payload("www.example.com");
assert(payload.css.includes("display: none !important"), "css payload generated");
assert(payload.css.length > 200, "css payload non-trivial");
const zhihuPayload = ZZ.RuleIndex.payload("www.zhihu.com");
assert(
  zhihuPayload.css.includes(".TopstoryItem--advertCard"),
  "domain scoped rule applies to matching host"
);
const otherPayload = ZZ.RuleIndex.payload("example.org");
assert(
  !otherPayload.css.includes(".TopstoryItem--advertCard"),
  "domain scoped rule does not leak to other hosts"
);

// 运行时加载：每个注册包都要真的读到规则，且总数与磁盘一致
const packsLoaded = await ZZ.RuleIndex.loadPacks();
assertEqual(
  ZZ.RuleIndex.PACKS.filter((p) => !(packsLoaded[p.id] || []).length).map((p) => p.id),
  [],
  "every registered pack loads rules at runtime"
);
assertEqual(
  Object.values(packsLoaded).reduce((n, list) => n + list.length, 0),
  ruleCount,
  "runtime pack load covers every rule on disk"
);

console.log("");
if (errors) {
  console.error(`validate-rules: ${errors} errors`);
  process.exit(1);
}
console.log(`validate-rules: all good (${ruleCount} rules in ${packs.length} packs)`);

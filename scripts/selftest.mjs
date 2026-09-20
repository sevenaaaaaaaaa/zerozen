#!/usr/bin/env node
import { makeSandbox, load, loadRuleEngine, assert, assertEqual } from "./harness.mjs";

const sandbox = makeSandbox();
loadRuleEngine(sandbox);
const ZZ = sandbox.ZZ;
const F = ZZ.RuleFormat;

console.log("rule format");

assert(F.normalize({ kind: "cosmetic", selector: "div.ad" }, "user").action === "hide", "cosmetic defaults to hide");
assert(F.normalize({ kind: "network", filter: "||a.com^" }, "user").action === "block", "network defaults to block");
assert(F.normalize({ kind: "network", filter: "||a.com^" }, "user").domains.length === 0, "domains default empty");
assert(F.validateSelector("div.ad-slot") === null, "valid selector passes");
assert(!!F.validateSelector("body"), "body selector rejected");
assert(!!F.validateSelector("div { color: red }"), "css injection rejected");
assert(!!F.validateSelector("a; background: url(x)"), "url() injection rejected");
assert(!!F.validateSelector(""), "empty selector rejected");
assert(F.normalizeDomain("*.Foo.COM/path?x=1") === "foo.com", "domain normalization");
assert(F.ruleDomainMatch("www.example.com", "example.com") === true, "subdomain match");
assert(F.ruleDomainMatch("example.com.evil.org", "example.com") === false, "suffix spoof rejected");

console.log("\nadblock import");

const adblock = [
  "! comment",
  "[Adblock Plus 2.0]",
  "||ads.example.com^",
  "||track.example.net^$third-party,script",
  "@@||ads.example.com/allowed^",
  "example.com##.ad-banner",
  "example.com,news.example.com##.sponsor-box",
  "example.com#@#.ad-banner",
  "##.global-ad",
  "||bad.example.com^$csp=script-src 'none'",
  "example.com##.ad:has(.inner)",
  "||pop.example.com^$popup",
  "/banner\\d+/",
  "||multi.example.com^$domain=a.com|b.com",
  "||important.example.com^$important",
  "~excluded.example.com##.everywhere-ad",
  "example.com##body *",
  "example.com##div.ad|img.ad",
].join("\n");

const parsed = F.parseAdblockText(adblock, { source: "import" });
console.log(`  imported=${parsed.rules.length} skipped=${parsed.skipped.length}`);
assertEqual(parsed.rules.length, 12, "imported expected rule count");
assert(parsed.network.some((r) => r.filter === "||ads.example.com^" && r.action === "block"), "basic network rule");
assert(
  parsed.network.some(
    (r) => r.filter === "||multi.example.com^" && r.domains.join(",") === "a.com,b.com"
  ),
  "$domain=a|b parsed into initiator domains"
);
assert(
  parsed.network.some((r) => r.filter === "||important.example.com^" && r.priority === 105),
  "$important gets top priority"
);
assert(
  parsed.cosmetic.some((r) => r.selector === ".everywhere-ad" && r.excludeDomains.includes("excluded.example.com")),
  "~domain cosmetic exclusion parsed"
);
assert(!parsed.cosmetic.some((r) => r.selector === "body *"), "body * selector rejected");
assert(!parsed.cosmetic.some((r) => (r.selector || "").includes("|")), "pipe-joined selector rejected");
assert(
  parsed.network.some((r) => r.filter === "||track.example.net^" && r.thirdParty === true && r.resourceTypes.includes("script")),
  "third-party + resource type option"
);
assert(parsed.network.some((r) => r.filter === "||ads.example.com/allowed^" && r.action === "allow"), "exception network rule");
assert(parsed.cosmetic.some((r) => r.selector === ".ad-banner" && r.domains.includes("example.com")), "domain cosmetic rule");
assert(parsed.cosmetic.some((r) => r.selector === ".sponsor-box" && r.domains.length === 2), "multi-domain cosmetic rule");
assert(parsed.cosmetic.some((r) => r.selector === ".ad-banner" && r.action === "allow"), "cosmetic exception rule");
assert(parsed.cosmetic.some((r) => r.selector === ".global-ad" && r.domains.length === 0), "global cosmetic rule");
assert(parsed.cosmetic.some((r) => r.selector === ".ad:has(.inner)"), ":has() selector kept");
assert(parsed.skipped.some((s) => /csp/.test(s.reason)), "csp option reported as skipped");
assert(parsed.skipped.some((s) => /popup/.test(s.reason)), "popup option reported as skipped");
assert(
  parsed.network.some((r) => r.regexFilter === "/banner\\d+/"),
  "regex filter converted to regexFilter rule"
);
const regexDnr = ZZ.RuleIndex.build(parsed.rules, null) && ZZ.RuleIndex.compileDNR(500).rules;
assert(regexDnr.some((r) => r.condition.regexFilter === "banner\\d+"), "regexFilter stripped of slashes for dnr");

console.log("\nadblock export roundtrip");

const exported = F.toAdblockText(parsed.rules);
const reparsed = F.parseAdblockText(exported, { source: "import" });
assert(reparsed.network.some((r) => r.filter === "||ads.example.com^"), "network survives export roundtrip");
assert(reparsed.cosmetic.some((r) => r.selector === ".ad-banner" && r.action === "hide"), "cosmetic survives export roundtrip");
assertEqual(
  F.dedupe(parsed.rules).length === F.dedupe(reparsed.rules).length,
  true,
  "roundtrip rule count stable"
);

console.log("\nnative format roundtrip");

const native = F.toNative(F.dedupe(parsed.rules), { version: "test" });
assert(native.format === "zerozen-rules", "native format marker");
const fromNative = F.parseNative(JSON.stringify(native));
assertEqual(fromNative.rules.length, F.dedupe(parsed.rules).length, "native roundtrip keeps all rules");
assert(F.parseNative("{ not json").error, "invalid json reported");

console.log("\nhost extraction + dnr compile");

const hosts = ZZ.RuleIndex.extractHosts("||ads.example.com^");
assertEqual(hosts, ["ads.example.com"], "extract host from ||filter");
const hosts2 = ZZ.RuleIndex.extractHosts("|https://cdn.example.net/ads/");
assert(hosts2.includes("cdn.example.net"), "extract host from absolute filter");

const idx = ZZ.RuleIndex.build(
  [
    F.normalize({ kind: "network", action: "block", filter: "||ads.example.com^", source: "user" }),
    F.normalize({
      kind: "network",
      action: "allow",
      filter: "||ads.example.com/ok^",
      source: "user",
    }),
    F.normalize({ kind: "cosmetic", selector: ".ad-banner", source: "user" }),
    F.normalize({ kind: "cosmetic", selector: ".ad-banner", action: "allow", domains: ["good.example.com"], source: "user" }),
    F.normalize({ kind: "cosmetic", selector: ".side-ad", action: "remove", domains: ["news.example.com"], source: "user" }),
    F.normalize({ kind: "text", text: "高速下载", tag: "a", source: "user" }),
  ],
  null
);
assertEqual(idx.networkHosts.has("ads.example.com"), true, "blocked host tracked");
const compiled = ZZ.RuleIndex.compileDNR(100);
assertEqual(compiled.rules.length, 2, "two dnr rules compiled");
const allowRule = compiled.rules.find((r) => r.action.type === "allow");
assert(allowRule && allowRule.priority === 100, "allow rule has higher priority");
assert(allowRule.condition.resourceTypes.includes("main_frame"), "allow rule covers main_frame");
const blockRule = compiled.rules.find((r) => r.action.type === "block");
assert(!blockRule.condition.resourceTypes.includes("main_frame"), "block rule never covers main_frame");

const payloadHost = ZZ.RuleIndex.payload("good.example.com");
assert(payloadHost.css.includes(".ad-banner") === false, "exception removes selector from host css");
assert(payloadHost.css.includes(".side-ad") === false, "domain scoped remove rule not applied elsewhere");

const payloadNews = ZZ.RuleIndex.payload("news.example.com");
assert(payloadNews.css.includes(".ad-banner"), "generic selector present on other host");
assert(payloadNews.css.includes(".side-ad"), "scoped remove rule present on its host");
assertEqual(payloadNews.remove.length, 1, "remove rule surfaced for host");
assertEqual(payloadNews.texts.length, 1, "text rule surfaced for host");
assert(payloadNews.texts[0].text === "高速下载", "text rule content");

const budgetCompiled = ZZ.RuleIndex.compileDNR(1);
assertEqual(budgetCompiled.rules.length, 1, "budget honored");
assertEqual(budgetCompiled.dropped.length, 1, "dropped rules reported");

console.log("\nexclusions and priorities");

const idxEx = ZZ.RuleIndex.build(
  [
    F.normalize({ kind: "cosmetic", selector: ".everywhere-ad", excludeDomains: ["excluded.example.com"], source: "user" }),
    F.normalize({ kind: "cosmetic", selector: ".scoped-ad", domains: ["shop.example.com"], source: "user" }),
    F.normalize({ kind: "network", action: "block", filter: "||ads.example.com^", priority: 105, source: "import" }),
    F.normalize({ kind: "network", action: "allow", filter: "||ads.example.com/ok^", source: "user" }),
  ],
  null
);
assert(ZZ.RuleIndex.payload("other.example.com").css.includes(".everywhere-ad"), "excluded-domain rule applies elsewhere");
assert(
  !ZZ.RuleIndex.payload("excluded.example.com").css.includes(".everywhere-ad"),
  "excluded-domain rule skipped on excluded host"
);
assert(
  !ZZ.RuleIndex.payload("excluded.sub.excluded2.com").css.includes(".scoped-ad"),
  "scoped rule does not leak"
);
const prioRules = ZZ.RuleIndex.compileDNR(100).rules;
const importantRule = prioRules.find((r) => r.condition.urlFilter === "||ads.example.com^");
const allowRule2 = prioRules.find((r) => r.action.type === "allow");
assert(importantRule.priority === 105, "$important block keeps priority above allow");
assert(allowRule2.priority === 100, "allow rule keeps standard priority");
assert(prioRules.filter((r) => r.action.type === "allow").length === 1, "allow rules compiled separately");

console.log("\nprotection profiles");
assert(ZZ.Profiles.IDS.length === 3, "three protection profiles");
const compatPacks = ZZ.Profiles.packMap("compat", { core: true, adult: true, annoyances: true, youtube: true, jp: true, oss: false });
assert(compatPacks.core === true && compatPacks.youtube === true && compatPacks.adult === true, "compat keeps common packs");
assert(compatPacks.annoyances === false && compatPacks.jp === false, "compat drops annoyances and regional packs");
assert(compatPacks.oss === false, "disabled pack stays disabled in compat");
const stdPayload = ZZ.RuleIndex.payload("profiles.example.com", { profile: "standard" });
const compatPayload = ZZ.RuleIndex.payload("profiles.example.com", { profile: "compat" });
const strictPayload = ZZ.RuleIndex.payload("profiles.example.com", { profile: "strict" });
assert(stdPayload.profile === "standard" && compatPayload.profile === "compat", "payload carries profile");
assert(stdPayload.textRules === true, "standard applies text rules");
assert(compatPayload.textRules === false && compatPayload.texts.length === 0, "compat drops text rules");
assert(strictPayload.textRemove === true && strictPayload.unlockScroll === true, "strict enables remove + forced unlock");

console.log("\nnonexistent host payload");
const payloadNone = ZZ.RuleIndex.payload("unknown.test");
assert(payloadNone.css === "" || !payloadNone.css.includes(".side-ad"), "no leakage to unrelated host");

console.log("\nstore stats");

const storeSandbox = makeSandbox();
load(storeSandbox, "background/lib-compat.js", "background/profiles.js", "background/rule-format.js", "background/store.js");
const S = storeSandbox.ZZ.Store;
await S.load();
await S.bumpStat("stats.example.com", { hidden: 2, popups: 1, lastSeen: 1000 });
await S.bumpStat("stats.example.com", { hidden: 3, lastSeen: 2000 });
const rec = S.stats()["stats.example.com"];
assertEqual(rec.hidden, 5, "counter fields accumulate");
assertEqual(rec.popups, 1, "popup counter accumulates");
assert(rec.lastSeen, "lastSeen is overwritten, not accumulated");
assertEqual(rec.lastSeen, 2000, "lastSeen is overwritten, not accumulated");
assert(S.KEYS.stats === "zz.stats", "stats storage key stable");

console.log("\nsite profile overrides");

await S.updateSite("site.example.com", { profile: "compat" });
assert(S.profileFor("site.example.com").profile === "compat", "site profile override wins");
assert(S.profileFor("site.example.com").source === "site", "site override source");
await S.updateSite("site.example.com", { autoCompat: { at: Date.now(), reason: "anti-adblock" } });
assert(S.profileFor("site.example.com").source === "auto", "auto fallback marked");
await S.updateSite("site.example.com", { until: Date.now() + 60000 });
assert(S.profileFor("site.example.com").profile === "off", "temporary pause disables site");
assert(S.siteEnabled("site.example.com") === false, "siteEnabled respects temporary pause");
await S.updateSite("site.example.com", { clearAuto: true });
assert(S.profileFor("site.example.com").profile === "standard", "clearAuto restores global profile");
assert(S.profileFor("other.example.com").profile === "standard", "unrelated host uses global profile");

if (process.exitCode) {
  console.error("\nselftest: FAILED");
} else {
  console.log("\nselftest: all good");
}

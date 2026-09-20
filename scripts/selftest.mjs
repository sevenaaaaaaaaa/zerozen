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

console.log("\n规则订阅");

const subSandbox = makeSandbox();
const memory = {};
subSandbox.chrome.storage.local = {
  async get(keys) {
    if (keys == null) return { ...memory };
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const k of list) if (k in memory) out[k] = memory[k];
    return out;
  },
  async set(obj) {
    Object.assign(memory, obj);
  },
};
subSandbox.chrome.alarms = undefined;
load(
  subSandbox,
  "background/lib-compat.js",
  "background/rule-format.js",
  "background/store.js",
  "background/profiles.js",
  "background/rule-index.js",
  "background/subscriptions.js"
);
const SubZ = subSandbox.ZZ;
const Subs = SubZ.Subscriptions;
const T = Subs.__test;
let rebuilds = 0;
SubZ.Main = {
  async init() {
    return true;
  },
  async rebuild() {
    rebuilds++;
    return {};
  },
};

const hostsText = [
  "# comment line",
  "0.0.0.0 ads.hosts-example.com",
  "127.0.0.1 localhost",
  "127.0.0.1 tracker.hosts-example.net # inline",
  "plain-domain-example.org",
  "##.global-sub-ad",
].join("\n");
const pre = T.preprocess(hostsText);
assert(pre.includes("||ads.hosts-example.com^"), "hosts 0.0.0.0 line converted");
assert(pre.includes("||tracker.hosts-example.net^"), "hosts line with inline comment converted");
assert(!pre.includes("localhost"), "localhost entry dropped");
assert(pre.includes("||plain-domain-example.org^"), "bare domain converted");
assert(pre.includes("##.global-sub-ad"), "cosmetic rule kept");
assert(!pre.includes("# comment line"), "hosts comment dropped");

assert(T.normalizeUrl("https://a.example/list.txt"), "https url accepted");
assert(T.normalizeUrl("javascript:alert(1)") === null, "javascript url rejected");
assert(T.normalizeUrl("ftp://a.example/x.txt") === null, "ftp url rejected");
assert(T.normalizeUrl("not a url") === null, "garbage url rejected");

const meta = T.metaOf("! Title: Demo List\n! Version: 202609200\n! Expires: 2 days\n||x.example^");
assertEqual(meta.title, "Demo List", "list title parsed");
assertEqual(meta.expiresHours, 48, "expires parsed into hours");

const capped = T.capRules(
  Array.from({ length: 20 }, (_, i) => ({ kind: "network", n: i })),
  Array.from({ length: 20 }, (_, i) => ({ kind: "cosmetic", n: i })),
  10
);
assertEqual(capped.length, 10, "cap respects max rules");
assertEqual(capped.filter((r) => r.kind === "cosmetic").length, 4, "cosmetic rules keep their share of the budget");

const listText = [
  "! Title: ZeroZen Test List",
  "! Expires: 1 days",
  "||ads.subtest.com^",
  "||ads.subtest.com^",
  "subtest.com##.sub-ad-banner",
  "0.0.0.0 hosts.subtest.com",
  "@@||subtest.com/ok^",
].join("\n");

const parsedSub = T.parseText(listText, "sub1", 15000);
assert(!parsedSub.error, "list parses without error");
assert(parsedSub.rules.every((r) => r.source === "sub" && r.sub === "sub1"), "parsed rules tagged with subscription id");
assertEqual(parsedSub.rules.filter((r) => r.filter === "||ads.subtest.com^").length, 1, "duplicate lines deduped");
assert(parsedSub.rules.some((r) => r.filter === "||hosts.subtest.com^"), "hosts entry parsed into network rule");
assert(parsedSub.rules.some((r) => r.selector === ".sub-ad-banner"), "cosmetic entry parsed");

let served = 0;
subSandbox.fetch = async (url, opts) => {
  served++;
  const headers = (opts && opts.headers) || {};
  if (headers["If-None-Match"] === "\"v1\"") {
    return { ok: false, status: 304, headers: { get: () => null }, text: async () => "" };
  }
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => (String(k).toLowerCase() === "etag" ? "\"v1\"" : null) },
    text: async () => listText,
  };
};

const SubStore = SubZ.Store;
await SubStore.load();
const added = await Subs.add({ url: "https://filters.example.com/list.txt", name: "测试订阅" });
assert(added.ok, "subscription added");
assert(added.result && added.result.ok, "first update succeeded");
const items = Subs.list();
assertEqual(items.length, 1, "subscription stored in settings");
assert(items[0].ruleCount > 0, "subscription rules stored");
assert(items[0].lastStatus === "ok", "subscription status ok");
assert(rebuilds > 0, "engine rebuild triggered after update");

const subId = items[0].id;
assertEqual(SubStore.subRules().length, items[0].ruleCount, "subRules returns stored rules");
assertEqual(
  SubStore.activeRules().length,
  SubStore.rules().length + items[0].ruleCount,
  "activeRules merges user rules and subscription rules"
);

const again = await Subs.update(subId, { force: false });
assert(again.ok && again.notModified, "conditional request honours 304");
assertEqual(Subs.list()[0].ruleCount, items[0].ruleCount, "304 keeps previously stored rules");

await Subs.setEnabled(subId, false);
assertEqual(SubStore.subRules().length, 0, "disabled subscription contributes no rules");
assertEqual(SubStore.activeRules().length, SubStore.rules().length, "activeRules drops disabled subscription");
await Subs.setEnabled(subId, true);
assert(SubStore.subRules().length > 0, "re-enabled subscription contributes rules again");

const dup = await Subs.add({ url: "https://filters.example.com/list.txt" });
assert(!dup.ok, "duplicate subscription url rejected");
const badUrl = await Subs.add({ url: "javascript:alert(1)" });
assert(!badUrl.ok, "non-http subscription url rejected");

subSandbox.fetch = async () => {
  throw new Error("boom");
};
const failed = await Subs.update(subId, { force: true });
assert(!failed.ok, "network failure reported");
assertEqual(Subs.list()[0].lastStatus, "error", "failed update marked in status");
assert(SubStore.subRules().length > 0, "failed update keeps the last good rules");

await Subs.remove(subId);
assertEqual(Subs.list().length, 0, "subscription removed");
assertEqual(SubStore.subRules().length, 0, "removed subscription drops its rules");

assertEqual(T.clampInterval(1), 6, "interval clamped to minimum");
assertEqual(T.clampInterval(99999), 720, "interval clamped to maximum");
assertEqual(T.clampMaxRules(10), 500, "max rules clamped to minimum");

console.log("\n可选权限");

const permSandbox = makeSandbox();
const grantedSet = new Set(["bookmarks"]);
permSandbox.chrome.permissions = {
  async contains(req) {
    return (req.permissions || []).every((p) => grantedSet.has(p));
  },
  async remove(req) {
    for (const p of req.permissions || []) grantedSet.delete(p);
    return true;
  },
  onAdded: { addListener() {} },
  onRemoved: { addListener() {} },
};
load(permSandbox, "background/lib-compat.js", "background/permissions.js");
const Perms = permSandbox.ZZ.Perms;
const permStatus = await Perms.status();
assert(permStatus.supported, "permissions api detected");
assertEqual(permStatus.granted.bookmarks, true, "granted permission reported");
assertEqual(permStatus.granted.history, false, "missing permission reported");
assertEqual(permStatus.items.length, 4, "four optional permissions described");
assert(
  permStatus.items.every((p) => p.name && p.why && (p.features || []).length),
  "every optional permission carries a user-facing reason"
);
await Perms.remove("bookmarks");
assertEqual((await Perms.status()).granted.bookmarks, false, "permission revoke reflected");

let reinstalled = 0;
permSandbox.ZZ.Counts = { installNetworkCounter: () => reinstalled++ };
permSandbox.ZZ.Sniffer = { install: () => reinstalled++ };
Perms.onGranted(["webRequest"]);
assertEqual(reinstalled, 2, "webRequest grant re-installs counter and sniffer");
Perms.onGranted(["bookmarks"]);
assertEqual(reinstalled, 2, "unrelated grant does not re-install listeners");

console.log("\n订阅规则优先级");

const weightSandbox = makeSandbox();
loadRuleEngine(weightSandbox);
const WF = weightSandbox.ZZ.RuleFormat;
const WIdx = weightSandbox.ZZ.RuleIndex;
const builtinRule = WF.normalize(
  { kind: "cosmetic", selector: ".shared-ad", domains: ["weight.example.com"], source: "builtin", note: "builtin" },
  "builtin"
);
const subRule = WF.normalize(
  { kind: "cosmetic", selector: ".shared-ad", domains: ["weight.example.com"], source: "sub", note: "sub" },
  "sub"
);
WIdx.build([subRule, builtinRule], {});
const kept = WIdx.current().rules.filter((r) => r.selector === ".shared-ad");
assertEqual(kept.length, 1, "identical builtin and subscription rules deduped");
assertEqual(kept[0].source, "builtin", "builtin rule wins over subscription rule");

if (process.exitCode) {
  console.error("\nselftest: FAILED");
} else {
  console.log("\nselftest: all good");
}

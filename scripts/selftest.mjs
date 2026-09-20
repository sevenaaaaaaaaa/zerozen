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

console.log("\nAI 识别");

const aiSandbox = makeSandbox();
const aiMemory = {};
aiSandbox.chrome.storage.local = {
  async get(keys) {
    if (keys == null) return { ...aiMemory };
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const k of list) if (k in aiMemory) out[k] = aiMemory[k];
    return out;
  },
  async set(obj) {
    Object.assign(aiMemory, obj);
  },
};
load(
  aiSandbox,
  "background/lib-compat.js",
  "background/ai-prompt.js",
  "background/rule-format.js",
  "background/store.js",
  "background/profiles.js",
  "background/rule-index.js",
  "background/ai.js"
);
const AiZ = aiSandbox.ZZ;
const Ai = AiZ.Ai;
const AiT = Ai.__test;

assertEqual(AiT.endpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions", "endpoint appends path");
assertEqual(AiT.endpoint("https://api.openai.com/v1/"), "https://api.openai.com/v1/chat/completions", "endpoint trims trailing slash");
assertEqual(
  AiT.endpoint("https://x.example/v1/chat/completions"),
  "https://x.example/v1/chat/completions",
  "endpoint keeps full path"
);
assertEqual(AiT.endpoint(""), "", "empty base url yields no endpoint");

assert(AiT.extractJson('```json\n{"results":[]}\n```').results.length === 0, "fenced json parsed");
assertEqual(AiT.extractJson('prefix {"a":1,} suffix').a, 1, "trailing comma tolerated");
assertEqual(AiT.extractJson("not json at all"), null, "garbage returns null");
assertEqual(
  AiT.sanitize("Bad key sk-secret-123 rejected", { ai: { apiKey: "sk-secret-123" } }),
  "Bad key *** rejected",
  "api key redacted from error text"
);

const candidate = {
  i: 0,
  tag: "div",
  sel: "div#ad-slot-1",
  gen: ".ad-slot",
  id: "ad-slot-1",
  cls: ["ad-slot"],
  score: 5,
  signals: ["class"],
  text: "赞助内容".repeat(60),
  attrs: { "data-ad": "1" },
  rect: { w: 300, h: 250 },
};
const payloadOn = JSON.parse(
  AiZ.AiPrompt.candidatePayload([candidate], { host: "p.example.com" }, { ai: { sendText: true, sendAttrs: true } })
);
assert(payloadOn.candidates[0].txt.length === 140, "element text capped at 140 chars");
assert(payloadOn.candidates[0].attr, "attributes sent when enabled");
const payloadOff = JSON.parse(
  AiZ.AiPrompt.candidatePayload([candidate], { host: "p.example.com" }, { ai: { sendText: false, sendAttrs: false } })
);
assert(payloadOff.candidates[0].txt === undefined, "no element text sent when sendText is off");
assert(payloadOff.candidates[0].attr === undefined, "no attributes sent when sendAttrs is off");
assert(!JSON.stringify(payloadOff).includes("赞助内容"), "disabled text never reaches the request body");

assertEqual(Ai.normalizeResult({ ad: false }, candidate, "p.example.com"), null, "non-ad result dropped");
const normal = Ai.normalizeResult(
  { ad: true, confidence: 2, selector: ".ad-slot", category: "banner", generic: true, blockDomain: "Ads.Example.COM" },
  candidate,
  "p.example.com"
);
assertEqual(normal.confidence, 1, "confidence clamped to 1");
assertEqual(normal.blockDomain, "ads.example.com", "block domain lowercased");
assertEqual(normal.generic, true, "generic flag kept");
const badCategory = Ai.normalizeResult({ ad: true, selector: ".ad-slot", category: "nonsense" }, candidate, "p.example.com");
assertEqual(badCategory.category, "other", "unknown category falls back to other");
const unsafe = Ai.normalizeResult({ ad: true, selector: "body", confidence: 0.9 }, candidate, "p.example.com");
assertEqual(unsafe.selector, ".ad-slot", "unsafe selector falls back to candidate selector");
assert(unsafe.fallback === true, "fallback marked");
assert(unsafe.confidence < 0.9, "fallback lowers confidence");
const noSelector = Ai.normalizeResult({ ad: true, selector: "body" }, { i: 1, tag: "div" }, "p.example.com");
assertEqual(noSelector, null, "result without any usable selector dropped");

const AiStore = AiZ.Store;
await AiStore.load();
await AiStore.saveSettings({
  ai: { enabled: true, baseUrl: "https://ai.example.com/v1", apiKey: "sk-test", model: "test-model", maxCandidates: 10 },
});
let aiCalls = 0;
let lastBody = null;
aiSandbox.fetch = async (url, opts) => {
  aiCalls++;
  lastBody = JSON.parse(opts.body);
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        choices: [
          {
            message: {
              content: '```json\n{"results":[{"i":0,"ad":true,"confidence":0.95,"category":"banner","selector":".ad-slot","generic":true}]}\n```',
            },
          },
        ],
        usage: { total_tokens: 100 },
      });
    },
  };
};
const classified = await Ai.classify({ host: "p.example.com", candidates: [candidate], url: "https://p.example.com/a", title: "t" });
assert(classified.ok, "classify succeeded");
assertEqual(classified.findings.length, 1, "one finding returned");
assertEqual(classified.findings[0].selector, ".ad-slot", "finding carries selector");
assertEqual(aiCalls, 1, "one upstream request made");
assert(lastBody.model === "test-model", "configured model used");
assert(!JSON.stringify(lastBody).includes("<html"), "no raw html in request body");
const classifiedAgain = await Ai.classify({ host: "p.example.com", candidates: [candidate] });
assertEqual(aiCalls, 1, "second run served from cache");
assertEqual(classifiedAgain.calls, 0, "cached run reports zero calls");
assertEqual(classifiedAgain.findings.length, 1, "cached finding returned");

aiSandbox.fetch = async () => ({
  ok: false,
  status: 401,
  async text() {
    return JSON.stringify({ error: { message: "Invalid key sk-test" } });
  },
});
await AiStore.setAiCache({});
const aiFailed = await Ai.classify({ host: "err.example.com", candidates: [candidate] });
assert(!aiFailed.ok, "upstream error reported");
assert(!String(aiFailed.error).includes("sk-test"), "api key never surfaced in error");

console.log("\n自动学习");

const learnSandbox = makeSandbox();
const learnMemory = {};
learnSandbox.chrome.storage.local = {
  async get(keys) {
    if (keys == null) return { ...learnMemory };
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const k of list) if (k in learnMemory) out[k] = learnMemory[k];
    return out;
  },
  async set(obj) {
    Object.assign(learnMemory, obj);
  },
};
load(
  learnSandbox,
  "background/lib-compat.js",
  "background/rule-format.js",
  "background/store.js",
  "background/profiles.js",
  "background/rule-index.js",
  "background/learn.js"
);
const Learn = learnSandbox.ZZ.Learn;
const LearnStore = learnSandbox.ZZ.Store;
await LearnStore.load();

assertEqual(await Learn.observe("a.example.com", ".main-content"), null, "non-ad selector not learned");
assertEqual(await Learn.observe("a.example.com", "div:nth-child(3)"), null, "positional selector not learned");
assertEqual(await Learn.observe("", ".ad-slot"), null, "observation without host ignored");
assert(await Learn.observe("a.example.com", ".ad-slot"), "ad-like selector learned");
assertEqual((await Learn.candidates()).length, 0, "one site is not enough to generalize");
await Learn.observe("b.example.com", ".ad-slot");
const learnCandidates = await Learn.candidates();
assertEqual(learnCandidates.length, 1, "pattern promoted after two sites");
assertEqual(learnCandidates[0].sites, 2, "site count tracked");
await Learn.observe("b.example.com", ".ad-slot");
assertEqual((await Learn.candidates())[0].sites, 2, "repeat host does not inflate site count");

const generalized = await Learn.maybeGeneralize("c.example.com", "#ad-box", ".promo-banner");
assertEqual(generalized, null, "first sighting does not create a global rule");
const generalized2 = await Learn.maybeGeneralize("d.example.com", "#ad-box", ".promo-banner");
assert(generalized2 && generalized2.selector === ".promo-banner", "second site creates a global rule");
assertEqual(generalized2.domains.length, 0, "generalized rule applies to all sites");
assertEqual(generalized2.source, "learn", "generalized rule tagged as learned");
const generalized3 = await Learn.maybeGeneralize("e.example.com", "#ad-box", ".promo-banner");
assertEqual(generalized3, null, "already applied pattern is not re-added");
assertEqual(LearnStore.rules().filter((r) => r.selector === ".promo-banner").length, 1, "no duplicate learned rule");

await LearnStore.saveSettings({ learning: { autoApply: false } });
assertEqual(await Learn.maybeGeneralize("f.example.com", "#x", ".another-ad-slot"), null, "autoApply off disables generalization");

console.log("\n扫描结果转规则");

const scanSandbox = makeSandbox();
load(
  scanSandbox,
  "background/lib-compat.js",
  "background/rule-format.js",
  "background/store.js",
  "background/profiles.js",
  "background/rule-index.js",
  "background/scanner.js"
);
const Findings = scanSandbox.ZZ.Findings;
const siteRules = Findings.toRules(
  { host: "shop.example.com", selector: ".ad-box", genericSelector: ".ad-box", source: "ai", blockDomain: "ads.example.net", reason: "横幅广告" },
  "site"
);
assertEqual(siteRules.length, 2, "cosmetic + network rule generated");
assertEqual(siteRules[0].domains, ["shop.example.com"], "site scope keeps rule on one host");
assertEqual(siteRules[1].filter, "||ads.example.net^", "block domain converted to network filter");
const globalRules = Findings.toRules(
  { host: "shop.example.com", selector: "#ad-1", genericSelector: ".ad-box", source: "scan" },
  "global"
);
assertEqual(globalRules.length, 1, "no network rule without block domain");
assertEqual(globalRules[0].selector, ".ad-box", "global scope prefers the generic selector");
assertEqual(globalRules[0].domains.length, 0, "global scope has no domain restriction");
assertEqual(Findings.toRules({ host: "x.example.com", selector: "body", source: "scan" }, "site").length, 0, "unsafe selector produces no rule");

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

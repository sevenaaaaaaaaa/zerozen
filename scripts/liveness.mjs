#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Resolver } from "node:dns/promises";
import { ROOT } from "./harness.mjs";

const args = process.argv.slice(2);
const opts = { timeout: 4000, concurrency: 24, json: false, https: false, packs: false };
const files = [];
for (const a of args) {
  if (a === "--json") opts.json = true;
  else if (a === "--https") opts.https = true;
  else if (a === "--packs") opts.packs = true;
  else if (a.startsWith("--timeout=")) opts.timeout = Math.max(500, Number(a.split("=")[1]) || 4000);
  else if (a.startsWith("--concurrency=")) opts.concurrency = Math.max(1, Number(a.split("=")[1]) || 24);
  else files.push(a);
}
if (!files.length) {
  if (opts.packs) {
    for (const f of readdirSync(join(ROOT, "rules")).filter((f) => f.endsWith(".json"))) files.push(join(ROOT, "rules", f));
  } else {
    console.error("usage: node scripts/liveness.mjs <list.txt|pack.json>... [--packs] [--https] [--json] [--timeout=4000] [--concurrency=24]");
    process.exit(1);
  }
}

function extractDomains(file) {
  const text = readFileSync(file, "utf8");
  const out = new Set();
  if (file.endsWith(".json")) {
    const pack = JSON.parse(text);
    for (const r of pack.rules || []) {
      if (r.kind !== "network" || r.action !== "block") continue;
      const m = /^\|\|([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\^$/i.exec(String(r.filter || ""));
      if (m) out.add(m[1].toLowerCase());
    }
  } else {
    for (let line of text.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      const hosts = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1|::)\s+(\S+)/.exec(line);
      if (hosts) line = hosts[1];
      if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(line)) out.add(line.toLowerCase().replace(/\.$/, ""));
    }
  }
  return [...out];
}

const resolver = new Resolver({ timeout: opts.timeout, tries: 2 });

async function probeHttps(domain) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeout + 2000);
  try {
    const res = await fetch("https://" + domain + "/", { method: "HEAD", redirect: "follow", signal: ac.signal });
    return res.status ? "tls" : "tls";
  } catch (e) {
    return e.name === "AbortError" ? "tls-timeout" : "tls-fail";
  } finally {
    clearTimeout(t);
  }
}

async function check(domain) {
  const rec = { domain, dns: "dead", record: "", http: "" };
  for (const [fn, tag] of [
    [resolver.resolve4, "A"],
    [resolver.resolve6, "AAAA"],
    [resolver.resolveCname, "CNAME"],
    [resolver.resolveNs, "NS"],
  ]) {
    try {
      const v = await fn.call(resolver, domain);
      rec.dns = "alive";
      rec.record = tag;
      break;
    } catch (e) {
      if (e.code !== "ENOTFOUND" && e.code !== "ENODATA") rec.dns = "error:" + (e.code || e.message);
    }
  }
  if (opts.https && rec.dns === "alive") rec.http = await probeHttps(domain);
  return rec;
}

async function pool(items, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(opts.concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

const report = {};
for (const file of files) {
  const domains = extractDomains(file);
  const results = await pool(domains, check);
  const dead = results.filter((r) => r.dns === "dead").map((r) => r.domain);
  const alive = results.filter((r) => r.dns === "alive");
  const errored = results.filter((r) => r.dns.startsWith("error")).map((r) => r.domain + " (" + r.dns + ")");
  report[file] = { total: domains.length, alive: alive.length, dead: dead.length, errored: errored.length, deadList: dead, errorList: errored };
  if (!opts.json) {
    console.log(`${file}: total=${domains.length} alive=${alive.length} dead=${dead.length} error=${errored.length}`);
    if (dead.length) console.log("  dead: " + dead.join(", "));
    if (errored.length) console.log("  error: " + errored.join(", "));
  }
}
if (opts.json) console.log(JSON.stringify(report, null, 2));

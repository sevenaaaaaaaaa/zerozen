#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import vm from "node:vm";
import { report as i18nReport } from "./i18n-scan.mjs";

const root = new URL("..", import.meta.url).pathname;
const dirs = ["background", "content", "ui", "i18n"];
const extraFiles = [];
let errors = 0;
let checked = 0;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = [];
for (const dir of dirs) walk(join(root, dir), files);
files.push(...extraFiles);

for (const file of files) {
  const rel = relative(root, file);
  if (extname(file) === ".js") {
    const src = readFileSync(file, "utf8");
    try {
      new vm.Script(src, { filename: rel });
      checked++;
    } catch (e) {
      errors++;
      console.error(`FAIL  ${rel}: ${e.message}`);
    }
  } else if (extname(file) === ".json") {
    try {
      JSON.parse(readFileSync(file, "utf8"));
      checked++;
    } catch (e) {
      errors++;
      console.error(`FAIL  ${rel}: ${e.message}`);
    }
  }
}

const jsonRoot = ["manifest.json", "package.json"];
for (const f of jsonRoot) {
  try {
    JSON.parse(readFileSync(join(root, f), "utf8"));
    checked++;
  } catch (e) {
    errors++;
    console.error(`FAIL  ${f}: ${e.message}`);
  }
}

const manifestRaw = readFileSync(join(root, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestRaw);
const referenced = [];
referenced.push(...(manifest.background?.scripts || []));
referenced.push(manifest.background?.service_worker);
for (const cs of manifest.content_scripts || []) {
  referenced.push(...(cs.js || []), ...(cs.css || []));
}
for (const war of manifest.web_accessible_resources || []) {
  referenced.push(...(war.resources || []));
}
if (manifest.action?.default_popup) referenced.push(manifest.action.default_popup);
if (manifest.options_ui?.page) referenced.push(manifest.options_ui.page);
for (const size of ["16", "32", "48", "128"]) {
  referenced.push(manifest.icons?.[size]);
  referenced.push(manifest.action?.default_icon?.[size]);
}
for (const rel of referenced.filter(Boolean)) {
  try {
    statSync(join(root, rel));
    checked++;
  } catch (e) {
    errors++;
    console.error(`FAIL  manifest references missing file: ${rel}`);
  }
}

const indexJs = readFileSync(join(root, "background/index.js"), "utf8");
const imports = [...indexJs.matchAll(/"([^"]+\.js)"/g)].map((m) =>
  m[1].startsWith("../") ? m[1].slice(3) : "background/" + m[1]
);
let backgroundOk = true;
for (const rel of imports) {
  try {
    statSync(join(root, rel));
    checked++;
  } catch (e) {
    backgroundOk = false;
    errors++;
    console.error("FAIL  background/index.js imports missing file: " + rel);
  }
}
if (!imports.length) {
  errors++;
  console.error("FAIL  background/index.js has no importScripts entries");
} else if (!manifest.background?.service_worker) {
  errors++;
  console.error("FAIL  manifest.background.service_worker is missing");
} else if (backgroundOk) {
  checked++;
}

for (const pack of readdirSync(join(root, "rules"))) {
  if (!pack.endsWith(".json")) continue;
  const id = pack.replace("pack-", "").replace(".json", "");
  try {
    const data = JSON.parse(readFileSync(join(root, "rules", pack), "utf8"));
    if (data.id !== id) {
      errors++;
      console.error(`FAIL  rules/${pack}: id "${data.id}" does not match filename`);
    } else {
      checked++;
    }
  } catch (e) {
    errors++;
    console.error(`FAIL  rules/${pack}: ${e.message}`);
  }
}

for (const page of ["popup", "options"]) {
  const html = readFileSync(join(root, "ui", page + ".html"), "utf8");
  const js = readFileSync(join(root, "ui", page + ".js"), "utf8");
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const refs = new Set([...js.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]));
  const missing = [...refs].filter((r) => !ids.has(r));
  if (missing.length) {
    errors++;
    console.error(`FAIL  ui/${page}.js references missing ids: ${missing.join(", ")}`);
  } else {
    checked++;
  }
  const handlers = [...js.matchAll(/addEventListener\(\s*"([a-z]+)"/g)].length;
  if (!handlers) {
    errors++;
    console.error(`FAIL  ui/${page}.js has no event handlers`);
  }
}

const permsSrc = readFileSync(join(root, "background", "permissions.js"), "utf8");
const permIds = [...permsSrc.matchAll(/id:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]);
const optional = manifest.optional_permissions || [];
if (permIds.length !== optional.length || permIds.some((id) => !optional.includes(id))) {
  errors++;
  console.error("FAIL  background/permissions.js OPTIONAL does not match manifest optional_permissions");
  console.error("      permissions.js: " + permIds.join(", "));
  console.error("      manifest:       " + optional.join(", "));
} else {
  checked++;
}
for (const id of optional) {
  if ((manifest.permissions || []).includes(id)) {
    errors++;
    console.error(`FAIL  "${id}" listed in both permissions and optional_permissions`);
  } else {
    checked++;
  }
}

const messagesSrc = readFileSync(join(root, "background", "messages.js"), "utf8");
const cases = new Set([...messagesSrc.matchAll(/case "(zz:[a-z:-]+)"/g)].map((m) => m[1]));
const sent = new Set();
for (const file of ["ui/popup.js", "ui/options.js", "content/10-css.js", "content/30-guard.js", "content/60-bridge.js", "content/20-detector.js"]) {
  const src = readFileSync(join(root, file), "utf8");
  for (const m of src.matchAll(/type:\s*"(zz:[a-z:-]+)"/g)) sent.add(m[1]);
}
// popup 直发 content tab 的消息（tabs.sendMessage），不经过 background
const TAB_DIRECT = new Set(["zz:toolbox:streams", "zz:fx:clean"]);
const unhandled = [...sent].filter((t) => !cases.has(t) && !t.startsWith("zz:scan:") && !TAB_DIRECT.has(t));
if (unhandled.length) {
  errors++;
  console.error(`FAIL  messages sent but not handled in background: ${unhandled.join(", ")}`);
} else {
  checked++;
}

const localeEn = JSON.parse(readFileSync(join(root, "_locales/en/messages.json"), "utf8"));
const localeZh = JSON.parse(readFileSync(join(root, "_locales/zh_CN/messages.json"), "utf8"));
const enKeys = Object.keys(localeEn).sort();
const zhKeys = Object.keys(localeZh).sort();
if (enKeys.join(",") !== zhKeys.join(",")) {
  errors++;
  console.error("FAIL  _locales/en and _locales/zh_CN have different message keys");
} else {
  checked++;
}
for (const m of manifestRaw.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
  if (!localeEn[m[1]]) {
    errors++;
    console.error(`FAIL  manifest uses __MSG_${m[1]}__ but _locales/en has no such message`);
  } else {
    checked++;
  }
}

const i18n = i18nReport();
if (i18n.problems.length) {
  errors += i18n.problems.length;
  for (const p of i18n.problems) console.error("FAIL  i18n " + p);
} else {
  checked++;
}
console.log(`i18n: ${i18n.uiKeys} UI keys + ${i18n.contentKeys} content keys translated`);

console.log(`\ncheck: ${checked} checks OK, ${errors} failures`);
process.exit(errors ? 1 : 0);

#!/usr/bin/env node
/**
 * 扫描代码里的中文文案 key（T("…") / ZZ.T("…") / data-i18n="…"），
 * 与 i18n/dict-en.js、i18n/dict-en-content.js 的英文词条比对。
 *
 * 用法：
 *   node scripts/i18n-scan.mjs            # 报告缺失/多余
 *   node scripts/i18n-scan.mjs --json     # 输出缺失 key 的 JSON（供补词典）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import vm from "node:vm";

const root = new URL("..", import.meta.url).pathname;
const ZH = /[一-鿿]/;

export function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function scanKeys() {
  const skip = JSON.parse(readFileSync(join(root, "i18n/not-translated.json"), "utf8"));
  const skipFiles = new Set(Object.keys(skip.files || {}));
  const skipStrings = new Set(skip.strings || []);
  const files = [];
  for (const dir of ["ui", "background", "content"]) walk(join(root, dir), files);
  const ui = new Map();
  const content = new Map();
  for (const file of files) {
    const rel = relative(root, file);
    if (!/\.(js|html)$/.test(rel)) continue;
    if (rel.startsWith("i18n/")) continue;
    if (skipFiles.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    const bucket = rel.startsWith("content/") ? content : ui;
    const add = (key) => {
      if (!key || !ZH.test(key) || skipStrings.has(key)) return;
      if (!bucket.has(key)) bucket.set(key, []);
      if (!bucket.get(key).includes(rel)) bucket.get(key).push(rel);
    };
    if (rel.endsWith(".js")) {
      // 所有带中文的字符串字面量都必须有译文，漏包一层 T() 也能被发现
      for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) add(unescapeJs(m[1]));
      for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) add(unescapeJs(m[1]));
    }
    for (const m of src.matchAll(/data-i18n(?:-ph|-title)?="([^"]*)"/g)) add(decodeHtml(m[1]));
  }
  // 规则包的名称与说明存在 rules/pack-*.json 里，运行时会覆盖 rule-index.js 的默认值
  for (const file of readdirSync(join(root, "rules"))) {
    if (!file.endsWith(".json")) continue;
    const pack = JSON.parse(readFileSync(join(root, "rules", file), "utf8"));
    for (const key of [pack.name, pack.desc]) {
      if (!key || !ZH.test(key)) continue;
      if (!ui.has(key)) ui.set(key, []);
      if (!ui.get(key).includes("rules/" + file)) ui.get(key).push("rules/" + file);
    }
  }
  return { ui, content };
}

function unescapeJs(s) {
  return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function decodeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, "\n")
    .replace(/&amp;/g, "&");
}

export function loadDict(file) {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(root, file), "utf8"), sandbox, { filename: file });
  return sandbox.ZZ_DICT_EN || {};
}

// 译文必须保留与原文一致的 $1/$2 占位符，否则运行时会少一段信息
export function placeholderProblems(dicts) {
  const out = [];
  for (const dict of dicts) {
    for (const [key, value] of Object.entries(dict)) {
      const want = [...new Set([...key.matchAll(/\$(\d+)/g)].map((m) => m[1]))].sort();
      const got = [...new Set([...String(value).matchAll(/\$(\d+)/g)].map((m) => m[1]))].sort();
      if (want.join(",") !== got.join(",")) {
        out.push(`placeholder mismatch: ${JSON.stringify(key)} -> ${JSON.stringify(value)}`);
      }
    }
  }
  return out;
}

export function report() {
  const { ui, content } = scanKeys();
  const dictUi = loadDict("i18n/dict-en.js");
  const dictContent = loadDict("i18n/dict-en-content.js");
  for (const key of Object.keys(dictContent)) {
    if (key in dictUi && dictUi[key] !== dictContent[key]) {
      // 同一句话在两个词典里翻得不一样，容易前后不一致
      console.warn("warn  differs between dicts: " + JSON.stringify(key));
    }
  }
  const problems = placeholderProblems([dictUi, dictContent]);
  const missing = { ui: [], content: [] };
  for (const [key, files] of ui) {
    if (!(key in dictUi)) {
      missing.ui.push(key);
      problems.push(`missing (dict-en.js): ${JSON.stringify(key)}  <- ${files.join(", ")}`);
    }
  }
  for (const [key, files] of content) {
    if (!(key in dictContent)) {
      missing.content.push(key);
      problems.push(`missing (dict-en-content.js): ${JSON.stringify(key)}  <- ${files.join(", ")}`);
    }
  }
  const unusedUi = Object.keys(dictUi).filter((k) => !ui.has(k) && !content.has(k));
  const unusedContent = Object.keys(dictContent).filter((k) => !content.has(k));
  return {
    uiKeys: ui.size,
    contentKeys: content.size,
    problems,
    missing,
    unused: { ui: unusedUi, content: unusedContent },
  };
}

if (process.argv[1] && process.argv[1].endsWith("i18n-scan.mjs")) {
  const res = report();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(res.missing, null, 2));
  } else {
    for (const p of res.problems) console.error("FAIL  " + p);
    for (const k of res.unused.ui) console.warn("warn  unused in dict-en.js: " + JSON.stringify(k));
    for (const k of res.unused.content) console.warn("warn  unused in dict-en-content.js: " + JSON.stringify(k));
    console.log(
      `\ni18n: ${res.uiKeys} UI keys, ${res.contentKeys} content keys, ${res.problems.length} missing translations`
    );
  }
  process.exit(res.problems.length ? 1 : 0);
}

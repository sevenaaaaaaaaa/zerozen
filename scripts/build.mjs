#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;
const SHARED = ["background", "content", "ui", "i18n", "_locales", "rules", "icons", "README.md", "docs"];

// Firefox 构建需要 background.scripts（Firefox 不支持 MV3 service_worker）。
// 以 background/index.js 的 importScripts 顺序为唯一来源，避免与清单重复维护。
const indexSrc = readFileSync(join(ROOT, "background", "index.js"), "utf8");
const BACKGROUND_SCRIPTS = [...indexSrc.matchAll(/"([^"]+\.js)"/g)].map((m) =>
  m[1].startsWith("../") ? m[1].slice(3) : "background/" + m[1]
);

// 递归复制：不用 fs.cpSync，它在部分挂载文件系统上会因为同步元数据失败（EACCES）
function copyTree(src, dest) {
  const st = statSync(src);
  if (!st.isDirectory()) {
    copyFileSync(src, dest);
    return;
  }
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) copyTree(join(src, entry), join(dest, entry));
}

function writeTarget(name, mutate) {
  const dir = join(DIST, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const item of SHARED) {
    const src = join(ROOT, item);
    if (existsSync(src)) copyTree(src, join(dir, item));
  }
  const out = JSON.parse(JSON.stringify(manifest));
  mutate(out);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(out, null, 2) + "\n");
  // 清单里引用的文件必须真的被复制进来，否则装上去才发现少文件
  const refs = [];
  refs.push(...(out.background?.scripts || []));
  if (out.background?.service_worker) refs.push(out.background.service_worker);
  for (const cs of out.content_scripts || []) refs.push(...(cs.js || []), ...(cs.css || []));
  for (const war of out.web_accessible_resources || []) refs.push(...(war.resources || []));
  if (out.action?.default_popup) refs.push(out.action.default_popup);
  if (out.options_ui?.page) refs.push(out.options_ui.page);
  if (out.default_locale) refs.push(`_locales/${out.default_locale}/messages.json`);
  for (const ref of refs.filter(Boolean)) {
    if (!existsSync(join(dir, ref))) {
      console.error(`  FAIL ${name}: manifest references ${ref} but it was not packaged`);
      process.exitCode = 1;
    }
  }
  console.log(`  ${name.padEnd(8)} -> dist/${name}`);
  return dir;
}

console.log("building extension targets:");

const chromeDir = writeTarget("chrome", (m) => {
  delete m.background.scripts;
  delete m.browser_specific_settings;
  // 商店发布用纯净名；本地多浏览器共存靠目录名区分即可
});

const firefoxDir = writeTarget("firefox", (m) => {
  delete m.background.service_worker;
  m.background.scripts = BACKGROUND_SCRIPTS;
  delete m.minimum_chrome_version;
  m.name = m.name + " (Firefox)";
  m.browser_specific_settings = {
    gecko: {
      id: "zerozen@local.extension",
      strict_min_version: "128.0",
    },
  };
});

const safariDir = writeTarget("safari", (m) => {
  delete m.background.scripts;
  delete m.minimum_chrome_version;
  delete m.browser_specific_settings;
  m.name = m.name + " (Safari)";
});

function zip(fromDir, outFile) {
  try {
    rmSync(outFile, { force: true });
    execFileSync("zip", ["-qr", outFile, "."], { cwd: fromDir });
    console.log(`  packaged -> ${relative(ROOT, outFile)}`);
  } catch (e) {
    console.warn(`  zip unavailable, skipped ${outFile}: ${e.message}`);
  }
}

zip(join(DIST, "chrome"), join(DIST, `zerozen-chrome-${version}.zip`));
zip(join(DIST, "firefox"), join(DIST, `zerozen-firefox-${version}.xpi`));

console.log(`
install:
  Chrome/Edge   chrome://extensions -> 开发者模式 -> 加载已解压的扩展程序 -> ${relative(ROOT, chromeDir)}
  Firefox       about:debugging#/runtime/this-firefox -> 临时载入附加组件 -> ${relative(ROOT, firefoxDir)}/manifest.json
  Safari        npm run build:safari   （需要 Xcode）
`);

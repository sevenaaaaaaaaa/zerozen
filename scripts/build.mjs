#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;
const SHARED = ["background", "content", "ui", "rules", "icons", "README.md", "docs"];

function writeTarget(name, mutate) {
  const dir = join(DIST, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const item of SHARED) {
    const src = join(ROOT, item);
    if (existsSync(src)) cpSync(src, join(dir, item), { recursive: true });
  }
  const out = JSON.parse(JSON.stringify(manifest));
  mutate(out);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`  ${name.padEnd(8)} -> dist/${name}`);
  return dir;
}

console.log("building extension targets:");

const chromeDir = writeTarget("chrome", (m) => {
  delete m.background.scripts;
  delete m.browser_specific_settings;
  m.name = m.name + " (Chrome)";
});

const firefoxDir = writeTarget("firefox", (m) => {
  delete m.background.service_worker;
  delete m.minimum_chrome_version;
  m.background.type = undefined;
  delete m.background.type;
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

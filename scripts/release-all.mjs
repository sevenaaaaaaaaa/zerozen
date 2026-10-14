#!/usr/bin/env node
// 一键发版打包：测试 → Arc / ego lite / Chrome / Firefox 包 → Safari Xcode 工程（同步版本号 + xcodebuild）
//
// 用法：
//   npm run release:all                     # 用当前版本号打包（不改版本）
//   npm run release:all -- --bump patch     # 先把版本号 +1（patch|minor|major|x.y.z），同步 manifest/package.json 后打包
//   npm run release:all -- --e2e            # 额外跑端到端测试
//   npm run release:all -- --skip-safari    # 跳过 Safari（无 Xcode 时）
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DIST = join(ROOT, "dist");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const APP_NAME = process.env.APP_NAME || "ZeroZen";
const SAFARI_OUT = join(DIST, "safari-app");
const XCODEPROJ = join(SAFARI_OUT, APP_NAME, `${APP_NAME}.xcodeproj`);

function step(title) {
  console.log(`\n==> ${title}`);
}
function run(cmd, argv, opts = {}) {
  execFileSync(cmd, argv, { cwd: ROOT, stdio: "inherit", ...opts });
}
function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
// 只替换 "version" 字段，保留文件其余格式
function setJSONVersion(file, v) {
  const src = readFileSync(file, "utf8");
  const out = src.replace(/("version"\s*:\s*")[^"]*(")/, `$1${v}$2`);
  writeFileSync(file, out);
}

// ---------- 1. 版本号 ----------
step("版本号");
const manifestPath = join(ROOT, "manifest.json");
const pkgPath = join(ROOT, "package.json");
let version = readJSON(manifestPath).version;
const pkgVersion = readJSON(pkgPath).version;
const bump = opt("--bump");
if (bump) {
  let next;
  if (/^\d+\.\d+\.\d+$/.test(bump)) next = bump;
  else {
    const [a, b, c] = version.split(".").map(Number);
    next = { major: `${a + 1}.0.0`, minor: `${a}.${b + 1}.0`, patch: `${a}.${b}.${c + 1}` }[bump];
    if (!next) die(`--bump 只接受 patch|minor|major|x.y.z，收到 ${bump}`);
  }
  setJSONVersion(manifestPath, next);
  setJSONVersion(pkgPath, next);
  console.log(`  ${version} -> ${next}（manifest.json / package.json）`);
  version = next;
} else if (pkgVersion !== version) {
  die(`manifest.json (${version}) 与 package.json (${pkgVersion}) 版本不一致；修正或用 --bump x.y.z 统一`);
} else {
  console.log(`  v${version}（manifest.json = package.json）`);
}

// ---------- 2. 测试 ----------
step("测试 npm test");
try {
  run("npm", ["test", "--silent"]);
  if (flag("--e2e")) {
    step("端到端 npm run e2e");
    run("npm", ["run", "e2e", "--silent"]);
  }
} catch {
  die("测试失败，已中止打包");
}

// ---------- 3. 构建 Chromium(Arc/ego/Chrome) + Firefox + Safari 源 ----------
step("构建扩展产物");
try {
  run("npm", ["run", "build", "--silent"]);
} catch {
  die("构建失败");
}

const artifacts = {
  arc: { dir: join(DIST, "arc"), pkg: join(DIST, `zerozen-arc-v${version}.zip`) },
  ego: { dir: join(DIST, "ego"), pkg: join(DIST, `zerozen-ego-v${version}.zip`) },
  chrome: { dir: join(DIST, "chrome"), pkg: join(DIST, `zerozen-chrome-${version}.zip`) },
  firefox: { dir: join(DIST, "firefox"), pkg: join(DIST, `zerozen-firefox-${version}.xpi`) },
};
for (const [name, a] of Object.entries(artifacts)) {
  const mv = existsSync(join(a.dir, "manifest.json")) && readJSON(join(a.dir, "manifest.json")).version;
  if (mv !== version) die(`${name} 产物版本 ${mv} ≠ ${version}`);
  if (!existsSync(a.pkg)) die(`缺少 ${relative(ROOT, a.pkg)}`);
}

// ---------- 4. Safari ----------
let safariResult = "skipped (--skip-safari)";
let safariApp = null;
if (!flag("--skip-safari")) {
  step("Safari：重新生成 Xcode 工程（引用最新 dist/safari 资源）");
  let hasXcode = true;
  try {
    execFileSync("xcrun", ["--find", "xcodebuild"], { stdio: "ignore" });
  } catch {
    hasXcode = false;
  }
  if (!hasXcode) {
    safariResult = "skipped（未安装 Xcode）";
    console.warn("  未找到 xcodebuild，跳过 Safari");
  } else {
    try {
      // 每次重新转换：转换器生成的是逐文件引用，新增/删除文件只有重新生成才会被工程收录
      run("bash", [join(ROOT, "scripts/build-safari.sh")], { stdio: ["ignore", "ignore", "inherit"] });
    } catch {
      die("safari-web-extension-converter 失败");
    }

    step(`Safari：同步版本号 ${version} 到 Xcode 工程`);
    const pbx = join(XCODEPROJ, "project.pbxproj");
    let src = readFileSync(pbx, "utf8");
    const before = (src.match(/MARKETING_VERSION = [^;]+;/g) || []).length;
    src = src
      .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
      .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${version};`);
    writeFileSync(pbx, src);
    console.log(`  project.pbxproj: ${before} 处 MARKETING_VERSION / CURRENT_PROJECT_VERSION -> ${version}`);
    // Info.plist 若写死了版本号（而非 $(MARKETING_VERSION)），一并改掉
    const plists = [];
    (function walk(d) {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) {
          if (!e.endsWith(".xcodeproj")) walk(p);
        } else if (e === "Info.plist") plists.push(p);
      }
    })(join(SAFARI_OUT, APP_NAME));
    for (const p of plists) {
      const s = readFileSync(p, "utf8");
      const out = s
        .replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)(?!\$\()[^<]*(<\/string>)/, `$1${version}$2`)
        .replace(/(<key>CFBundleVersion<\/key>\s*<string>)(?!\$\()[^<]*(<\/string>)/, `$1${version}$2`);
      if (out !== s) {
        writeFileSync(p, out);
        console.log(`  ${relative(ROOT, p)}: 版本号写死，已改为 ${version}`);
      }
    }

    step("Safari：xcodebuild（macOS）");
    const listing = execFileSync("xcodebuild", ["-list", "-project", XCODEPROJ], { encoding: "utf8" });
    const schemes = listing.split(/Schemes:\s*/)[1]?.split("\n").map((s) => s.trim()).filter(Boolean) || [];
    const scheme = schemes.find((s) => /macOS/i.test(s)) || schemes[0];
    const derived = join(SAFARI_OUT, "build");
    const base = ["-project", XCODEPROJ, "-scheme", scheme, "-configuration", "Release", "-destination", "generic/platform=macOS", "-derivedDataPath", derived, "-quiet", "build"];
    const tryBuild = (extra) => {
      try {
        run("xcodebuild", [...base, ...extra]);
        return true;
      } catch {
        return false;
      }
    };
    if (tryBuild([])) safariResult = `OK（已签名构建，scheme ${scheme}）`;
    else {
      console.warn("  签名构建失败（多半是未配置开发者账号），改用 CODE_SIGNING_ALLOWED=NO 做编译校验");
      if (tryBuild(["CODE_SIGNING_ALLOWED=NO"])) safariResult = `OK（未签名编译校验，scheme ${scheme}；要装进 Safari 需在 Xcode 里选签名账号后 Run）`;
      else die("Safari xcodebuild 失败");
    }
    const productDir = join(derived, "Build/Products/Release");
    safariApp = join(productDir, `${APP_NAME}.app`);
    if (existsSync(safariApp)) {
      const v = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", join(safariApp, "Contents/Info.plist")], { encoding: "utf8" }).trim();
      if (v !== version) die(`Safari app 版本 ${v} ≠ ${version}`);
      // codesign -dv 把信息写到 stderr
      const sig = execFileSync("sh", ["-c", 'codesign -dv "$1" 2>&1 || true', "sh", safariApp], { encoding: "utf8" });
      if (/Signature=adhoc/.test(sig) && safariResult.startsWith("OK（已签名")) {
        safariResult = `OK（ad-hoc 本地签名，scheme ${scheme}；Safari 需开「开发 → 允许未签名的扩展」或在 Xcode 选开发者账号）`;
      }
    }
  }
}

// ---------- 5. 汇总 ----------
const r = (p) => relative(ROOT, p);
console.log(`
============================================================
 ZeroZen v${version} 发版产物
============================================================
 Arc       包: ${r(artifacts.arc.pkg)}
           解压目录: ${r(artifacts.arc.dir)}
           安装: Arc 地址栏打开 arc://extensions（或 chrome://extensions）→ 右上角打开「开发者模式」
                 →「加载已解压的扩展程序」→ 选 ${artifacts.arc.dir}
 ego lite  包: ${r(artifacts.ego.pkg)}
           解压目录: ${r(artifacts.ego.dir)}
           安装: ego lite 打开 chrome://extensions → 打开「开发者模式」
                 →「加载已解压的扩展程序」→ 选 ${artifacts.ego.dir}
                 （也可把 zip 解压后拖进扩展页；已装过的点「重新加载」即可更新）
 Chrome    包: ${r(artifacts.chrome.pkg)}（商店上传用）
 Firefox   包: ${r(artifacts.firefox.pkg)}
           临时载入: about:debugging#/runtime/this-firefox → ${r(artifacts.firefox.dir)}/manifest.json
 Safari    工程: ${r(XCODEPROJ)}
           构建: ${safariResult}${safariApp && existsSync(safariApp) ? `\n           App: ${r(safariApp)}` : ""}
           安装: Xcode 打开工程 → macOS target 选签名账号 → Run → Safari 设置 → 扩展 → 勾选 ZeroZen
============================================================`);

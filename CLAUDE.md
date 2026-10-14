# CLAUDE.md — 零真 · ZeroZen

## 项目简介

ZeroZen：跨浏览器广告与弹窗净化扩展（Manifest V3）。规则引擎（declarativeNetRequest + 外观规则）+ AI 识别 + 收藏夹批量扫描 + 下载工具箱。无后端，隐私优先。支持 Chrome/Edge（105+）、Firefox（128+）、Safari（macOS 13+ / iOS 16.4+）。仓库 `github.com/sevenaaaaaaaaa/zerozen`。

## 技术栈

- 原生 JavaScript，无打包器、无运行时依赖；Node ≥ 18 仅用于脚本
- Chrome MV3 service worker（`background/index.js` 通过 importScripts 加载各模块；Firefox 构建时改为 background.scripts）
- 国际化：`_locales/` + `i18n/`
- Safari：`xcrun safari-web-extension-converter` 转 Xcode 工程

## 目录结构

```
manifest.json     Chrome MV3 清单（根目录清单仅供 Chrome；Firefox/Safari 用 dist 产物）
background/       后台：规则索引、DNR、AI、订阅、收藏夹扫描、下载中继等
content/          内容脚本（按数字前缀顺序加载：00-lib → 85-fx）
ui/               popup / options / toolbox / downloads 页面
rules/            规则包 pack-*.json
i18n/ _locales/   多语言
scripts/          构建、校验、自测、e2e、规则导入
docs/             使用指南、规则格式、隐私政策、商店文案
dist/             构建产物（chrome/arc/ego/firefox/safari + zip/xpi + safari-app，不入库）
```

## 常用命令

无依赖需安装（无 package-lock，`npm install` 非必需）。

```bash
npm run build          # 生成图标 + 构建 dist/chrome、dist/firefox、dist/safari 及 zip/xpi
npm run build:safari   # dist/safari → Xcode 工程（需 Xcode）
npm run release:all    # 一键发版：测试 + Arc/ego lite/Chrome/Firefox 包 + Safari 工程同步版本并 xcodebuild
npm test               # check + validate-rules + selftest
npm run check          # 静态检查
npm run validate       # 规则包校验
npm run selftest       # 自测
npm run e2e            # 端到端测试（启动浏览器，动态端口）
npm run i18n           # 未翻译文案扫描
npm run import:lists   # 导入外部规则列表
```

开发：无 dev server，Chrome「加载已解压的扩展程序」直接指向仓库根目录；Firefox 临时载入 `dist/firefox/manifest.json`。Lint：无独立 lint（`npm run check` 承担静态检查）。

## 部署方式

浏览器扩展，无服务器部署、无 CI。发布方式：`npm run build` 产出 `dist/zerozen-chrome-<ver>.zip` / `dist/zerozen-firefox-<ver>.xpi`，手动上传 Chrome Web Store（审核中）/ 分发 xpi；Safari 走 Xcode 工程。分支 `main`，功能通过 PR 合入。

## 发版/打包

**规则：每次开发完成后必须跑 `npm run release:all`，产出 Arc / ego lite / Firefox / Safari 四个版本。**

- 流程（`scripts/release-all.mjs`）：校验 manifest.json 与 package.json 版本一致 → `npm test`（失败即中止）→ `npm run build` → 重新生成 Safari Xcode 工程、把版本写入 MARKETING_VERSION / CURRENT_PROJECT_VERSION 并 `xcodebuild`（签名失败自动退回 `CODE_SIGNING_ALLOWED=NO` 做编译校验）→ 打印产物与安装方法
- 参数：`-- --bump patch|minor|major|x.y.z` 先统一升版本；`-- --e2e` 追加端到端测试；`-- --skip-safari` 跳过 Safari
- 产物：`dist/zerozen-arc-v<ver>.zip` + `dist/arc/`，`dist/zerozen-ego-v<ver>.zip` + `dist/ego/`，`dist/zerozen-firefox-<ver>.xpi`，`dist/zerozen-chrome-<ver>.zip`（商店），Safari 工程 `dist/safari-app/ZeroZen/ZeroZen.xcodeproj`、App `dist/safari-app/build/Build/Products/Release/ZeroZen.app`
- Arc（Chromium 155）与 ego lite（Chromium 152，`/Applications/ego lite.app`，`com.citrolabs.ego.lite`）共用 Chrome 清单，API 全支持
- 安装：Arc `arc://extensions`、ego lite `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → `dist/arc` / `dist/ego`；更新后在扩展页点「重新加载」

## 注意事项

- 无环境变量需求；AI 识别的 Key 由用户在扩展设置中填写
- 发版需同步 `manifest.json` 与 `package.json` 的 `version`
- 不要提交 `*.pem` / `*.crx`（扩展签名私钥与包，已在 .gitignore）
- 新增 background 模块需加到 `background/index.js` 的 importScripts 列表（Firefox 构建以其为唯一来源）
- 规则格式见 `docs/rules-format.md`，改规则后跑 `npm run validate`

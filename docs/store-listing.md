# 商店上架清单

面向 Chrome Web Store / Edge Add-ons / Firefox AMO 的提交材料与审核问答。提交前逐项确认。

## 0. 提交前检查

- [ ] `npm test` 全绿
- [ ] `npm run build` 生成 `dist/zerozen-chrome-<version>.zip` 与 `dist/zerozen-firefox-<version>.xpi`
- [ ] `manifest.json` 版本号与 `package.json` 一致
- [ ] 隐私政策已放到可公开访问的网址（中文见 `docs/privacy-policy.md`，英文见 `docs/privacy-policy.en.md`）
- [ ] `npm run i18n` 无缺失译文，英文界面逐屏走查过一遍
- [ ] 截图与图标已就绪（见下）
- [ ] 联系邮箱在开发者账号中已验证

## 1. 基本信息

| 字段 | 内容 |
| --- | --- |
| 名称 | ZeroZen 广告净化器（英文：ZeroZen Ad Cleaner，由 `_locales` 按浏览器语言切换） |
| 简介（132 字符内） | 规则引擎 + AI 识别的广告与弹窗屏蔽器，内置 7295+ 条规则，支持订阅开源列表、点选屏蔽与批量扫描。 |
| 类别 | 生产工具 / Privacy & Security |
| 语言 | 简体中文 + English（界面跟随浏览器语言，`default_locale` 为 en） |
| 单一用途声明 | 网页净化：屏蔽网页广告与打扰性元素，并提供配套的网页媒体保存工具（Block ads and intrusive page elements, with a companion web media saver）——下载工具箱与净化同属「网页内容治理」用途，审核问询按此口径 |

## 2. 详细描述（可直接粘贴）

```
ZeroZen 是一个纯本地运行的广告与弹窗净化扩展。

• 内置 41 个规则包、7295+ 条规则，覆盖搜索、视频、社交、论坛、电商、资讯与多语区站点
• 订阅 EasyList / EasyPrivacy / anti-AD / AdGuard 等开源过滤列表，按周期自动更新
• 网络拦截由浏览器的 declarativeNetRequest 完成，扩展看不到任何请求内容
• Alt+Z 点选页面元素直接生成规则，支持隐藏 / 移除 / 放行三种处理
• 可选接入你自己的 OpenAI 兼容接口，识别规则覆盖不到的原生广告（默认关闭）
• 兼容 / 标准 / 严格三档保护，遇到反广告拦截墙会自动回落，站点打不开可一键临时解除
• 纯净浏览与阅读模式，去掉侧栏与浮层，正文居中阅读

隐私：没有后端服务器，不收集、不上传任何浏览数据。只有你主动启用 AI 识别或添加规则订阅时，扩展才会向你自己填写的地址发起请求。收藏夹、浏览记录、下载权限都不在安装时申请，用到时才询问，并可随时收回。

隐私政策：https://github.com/sevenaaaaaaaaa/zerozen/blob/main/docs/privacy-policy.md
```

## 2b. 英文描述（Chrome Web Store / AMO 的英文 listing）

```
ZeroZen is a fully local ad and popup cleaner.

• 41 built-in rule packs, 7295+ rules covering search, video, social, forums, shopping, news and sites across Japan, Korea, Russia, Europe, South-East Asia, India, Latin America and Greater China
• Subscribe to EasyList / EasyPrivacy / anti-AD / AdGuard and any other filter list, refreshed automatically
• Network blocking runs on the browser's declarativeNetRequest engine — the extension never sees request contents
• Press Alt+Z to click any element and turn it into a rule (hide / remove / allow)
• Optionally plug in your own OpenAI-compatible endpoint to catch native ads that rules miss (off by default)
• Compatible / Standard / Strict protection levels, automatic fallback when a site detects ad blocking, and a one-click temporary pause
• Clean view and reader mode strip sidebars and overlays for distraction-free reading

Privacy: no backend server, no data collection, no uploads. The only outbound requests are the AI endpoint and the filter lists you configure yourself. Bookmarks, history and downloads permissions are requested only when you first use those features, and can be revoked at any time.

Privacy policy: <fill in the public URL>
```

## 3. 权限用途说明（审核必填）

逐条对应 Chrome Web Store 的 "Permission justification" 输入框：

| 权限 | 提交文案 |
| --- | --- |
| `storage` / `unlimitedStorage` | 在本地保存用户的规则、订阅、按站点设置与统计计数。不使用同步存储。 |
| `declarativeNetRequest` | 把广告与追踪域名编译成浏览器动态规则以拦截请求。扩展只提供规则，不读取请求内容。 |
| `scripting` | 向页面注入隐藏广告位的 CSS，并在用户按 Alt+Z 时注入元素选取器。 |
| `tabs` / `webNavigation` | 获取当前标签页的地址，以便套用该站点对应的规则与档位，并在导航后重新注入样式。 |
| `contextMenus` | 提供右键菜单「选取元素屏蔽」「本站暂停净化」。 |
| `alarms` | 按用户设定的周期检查规则订阅更新。 |
| `activeTab` | 快捷键触发时对当前标签页执行选取与识别。 |
| `host_permissions`（http/https） | 广告屏蔽必须在用户访问的任意站点生效。扩展不采集页面内容，也不把页面数据发往任何服务器。 |
| `bookmarks`（可选） | 用户主动点击「读取收藏夹」时，读取书签网址作为批量扫描的站点来源，只读不写。 |
| `history`（可选） | 用户主动开启「自主增强」时，在本地按域名聚合访问次数，挑出常访问站点优化规则，不上传。 |
| `downloads`（可选） | 把阅读模式的 Markdown、嗅探到的视频与页面图片保存到下载目录下的 ZeroZen/ 子目录。 |
| `webRequest`（可选） | 仅观察请求地址用于统计拦截数量和识别 m3u8/mpd 视频地址，不使用阻塞式回调，不读取请求内容。 |

远程代码：**不使用**。所有脚本随扩展包分发；规则订阅下载的是纯文本过滤规则数据，不是可执行代码，且只在本地解析成选择器与域名。

## 4. 素材清单

| 素材 | 规格 | 状态 |
| --- | --- | --- |
| 图标 | 128×128 PNG（`icons/icon128.png`，`npm run icons` 生成） | 已有 |
| 截图 1 | 1280×800 · 控制台「规则」页：规则包分组与数量 | 待补 |
| 截图 2 | 1280×800 · 控制台「订阅」页：订阅列表与自动更新设置 | 待补 |
| 截图 3 | 1280×800 · 弹窗：本页净化数量、档位切换、临时解除 | 待补 |
| 截图 4 | 1280×800 · Alt+Z 元素选取器高亮与生成规则面板 | 待补 |
| 截图 5 | 1280×800 · 同一页面净化前后对比 | 待补 |
| 英文截图 | 同上 5 张，界面语言切到 English（控制台「规则 → 界面语言」） | 待补 |
| 宣传图（可选） | 440×280 小图 / 1400×560 大图 | 待补 |

截图里不要出现个人邮箱、书签名称、浏览记录等个人信息。

## 5. Firefox AMO 额外事项

- `browser_specific_settings.gecko.id` 已设为 `zerozen@local.extension`，正式上架前改成你拥有的域名或邮箱形式的 ID。
- AMO 要求可复现的构建说明：仓库无构建依赖，`npm run build` 即产出 `dist/firefox`，在 "Build instructions" 里写明 Node 版本与该命令即可。
- 源码提交：仓库本身就是源码，`dist/` 已在 `.gitignore` 中。

## 6. 常见审核问题与回答

**Q：为什么需要所有网站的访问权限？**
广告屏蔽需要在用户访问的任意站点上套用 CSS 隐藏规则。扩展不读取页面文本、表单或 Cookie，也没有任何外发数据的通道（AI 识别与规则订阅除外，且都由用户主动配置目标地址）。

**Q：扩展是否加载远程代码？**
否。订阅功能下载的是 Adblock 语法的纯文本规则，解析后只会变成 CSS 选择器与域名匹配条件，不会被 eval 或注入为脚本。

**Q：AI 功能把数据发到哪里？**
发到用户自己在控制台填写的 OpenAI 兼容接口地址，开发者没有任何服务器参与。默认关闭。

# ZeroZen 广告净化器

[English](README.en.md)

跨浏览器（Chrome / Firefox / Safari）广告与弹窗屏蔽扩展：**规则引擎 + AI 自主识别 + 收藏夹批量扫描**，支持自定义规则导入导出。

内置 35 个规则包、7100+ 条规则（含 EasyList / AdGuard / uBlock 等开源列表的去重合并），覆盖搜索引擎、国内外视频/直播、社交平台（微博/小红书/知乎/Reddit/LinkedIn/X/Facebook）、论坛 BBS、技术社区（CSDN/掘金/博客园）、电商、下载站、成人站点，以及日本/韩国/俄罗斯/欧洲/东南亚/印度/拉美/港澳台等区域站点，音乐、游戏、体育、财经、旅游、教育、工具网盘等品类站点，还有小说/漫画类长尾站点的模板化广告。

## 功能

| 能力 | 说明 |
| --- | --- |
| 网络拦截 | 基于 `declarativeNetRequest` 动态规则，拦截广告联盟、追踪域名、广告接口 |
| 外观净化 | CSS 规则隐藏 + DOM 移除，覆盖主流站点的广告位、信息流广告、粘性浮层 |
| 弹窗守护 | 在页面世界劫持无手势的 `window.open` / 通知许可申请，拦截弹底与跳转劫持 |
| YouTube | 隐藏首页/播放页广告位，视频内广告自动跳过，压制反广告拦截弹窗 |
| AI 识别 | 把页面元素的**结构化描述**发给你自填的 OpenAI 兼容接口，识别规则覆盖不到的原生广告、假下载按钮、站点特有弹窗，并生成 CSS 规则 |
| 元素选取 | `Alt+Z` 或右键菜单点选页面元素直接生成规则（隐藏/移除/放行，可指定本站或全部站点） |
| 批量扫描 | 读取浏览器收藏夹或粘贴站点列表，快扫（直接抓 HTML）或渲染扫描（后台静默标签页），批量生成个性化规则，可选用 AI 复核 |
| 规则订阅 | 订阅 EasyList / anti-AD / AdGuard 等开源过滤列表，按周期自动拉取更新（支持条件请求与备用地址），内置 10 个预设源，也可填任意 http(s) 列表地址 |
| 规则管理 | 内置 11 个规则包可独立开关；自定义规则支持 JSON / Adblock 语法子集 / 纯域名列表导入，可导出 JSON 或 Adblock 文本 |
| 保护档位 | 兼容 / 标准 / 严格 三档，默认「标准」；弹窗里按站点一键切换，控制台可设全局默认 |
| 临时解除 | 一键放行当前站点 N 分钟（默认 30），到期自动恢复 |
| 屏蔽类型 | 网络拦截 / 外观隐藏 / 弹窗守护 / 烦扰元素 四个全局开关，弹窗内快切 |
| 反拦截回落 | 检测到多语言反广告拦截墙时自动降为「兼容」档；再次触发则自动临时放行，避免站点打不开 |
| 自主增强 | 读取浏览记录找出常访问站点并批量扫描优化；**仅支持本地小模型**（Ollama / LM Studio 等），不向云端发送任何数据 |
| AI 自动学习 | 从手动屏蔽、AI 确认、扫描结果里学习选择器模式，同一模式在多个站点出现后自动升级为通用规则 |
| 纯净浏览 | 弹窗一键隐藏导航/侧栏/评论/浮层，正文居中大字排版，再点一次恢复 |
| 阅读模式 | 提取正文生成无干扰阅读视图，可保存 Markdown 到本地（默认 `ZeroZen/阅读`） |
| 视频嗅探 | 监听页面 m3u8/mpd 请求，播放后一键下载；自动取页面标题（去掉站点名），fMP4 流直接存 `.mp4`，TS 流存 `.ts`（可在工具箱里选择命名 `.mp4`） |
| 图片发现 | 扫描页面图片，按格式/尺寸筛选、批量下载到 `ZeroZen/图片` |
| 网盘资源 | 自动提取网盘链接与提取码（百度/阿里/夸克/蓝奏/115/天翼/123/迅雷等），一键复制或导出 |
| 下载器 | 内置任务管理器：新建直链下载、实时进度/速度、暂停/继续/取消/重试、打开文件/所在文件夹、清除记录；支持多线程 Range 分段加速（服务器支持时） |
| 诚实付费 | 阅读保存、视频嗅探、图片发现、网盘收集采用诚实付费：功能免费，觉得好用请在控制台配置的支持链接付费 |
| 站点控制 | 总开关 + 单站点停用；弹窗拦截、AI 自动屏蔽等逐项可调 |
| 多语言 | 中英双语界面，跟随浏览器语言，可在控制台固定 |
| 统计 | 每个站点累计隐藏元素数、拦截请求数、拦截弹窗数，工具栏图标显示本页净化数量 |

## 安装

### Chrome / Edge / Brave / Arc

1. 打开 `chrome://extensions`，右上角开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择本目录（或 `dist/chrome`）
3. 点击工具栏图标 → 「打开净化控制台」

要求 Chrome 105+（`declarativeNetRequest` 动态规则、`scripting`）。

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`
2. 「临时载入附加组件」→ 选择 `manifest.json`（或 `dist/firefox/manifest.json`）
3. 长期使用建议用 `dist/zerozen-firefox-0.1.0.xpi` 走 `about:addons` 安装

要求 Firefox 128+。

### Safari（macOS 13+ / iOS 16.4+）

```bash
npm run build          # 生成 dist/safari
npm run build:safari   # 用 xcrun safari-web-extension-converter 转成 Xcode 工程
```

Xcode 中 Run 一次后，Safari → 设置 → 扩展 → 勾选 ZeroZen 并允许访问所有网站。
Safari 16.4 以下只支持外观规则，网络拦截需要系统支持 `declarativeNetRequest`。
Safari 不支持收藏夹接口，批量扫描请使用「自定义站点列表」。

## AI 识别配置

控制台 →「AI 识别」：

1. 勾选「启用 AI 识别」
2. 选择预设或填写任意 OpenAI 兼容地址：

   | 服务 | 地址 | 模型 |
   | --- | --- | --- |
   | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
   | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
   | 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
   | 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
   | 硅基流动 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
   | 本地 Ollama | `http://127.0.0.1:11434/v1` | `qwen2.5:7b`（Key 可留空） |

3. 「测试连接」，然后保存

**隐私**：只发送元素的结构化描述（标签名、class、id、尺寸、位置、最多 140 字短文本）与当前页面的地址、标题，**不上传网页正文、不截图、不上传 Cookie**。短文本与属性可在设置中关闭。请求直接发往你填写的地址，不经过任何第三方中转。
**费用控制**：单次最多分析元素数、单次扫描最多调用次数、置信度阈值、请求超时都可配置；同一元素 14 天内命中缓存不重复调用。

识别结果先进入「待审」列表，页面上会用橙色虚线框标出疑似广告并弹出工具条，可一键全部屏蔽；也可以在控制台逐条确认。打开「高置信度自动屏蔽」后，达到阈值的条目会直接生效。

## 规则订阅

控制台 →「订阅」：

1. 从预设列表里挑选（EasyList / EasyPrivacy / EasyList China / anti-AD / CJX / AdGuard / uBlock / Peter Lowe / 1Hosts），或直接填任意 http(s) 列表地址。
2. 支持的格式：Adblock 语法子集、hosts 文件（`0.0.0.0 ads.example.com`）、纯域名列表、ZeroZen JSON。
3. 自动更新：默认每 72 小时检查一次（`chrome.alarms`），带 `If-None-Match` / `If-Modified-Since` 条件请求，服务端返回 304 就不重新解析；列表自身的 `! Expires:` 会被采纳为更长的间隔。主地址失败时自动改走备用地址（jsDelivr / raw 镜像）。
4. 单个订阅默认最多保留 15000 条规则，超出按「外观规则优先」截断——网络拦截规则受浏览器动态规则预算限制，留太多也用不上。
5. 网络规则预算（默认 4500）可在同一面板调整，Chrome 121+ 最高约 30000。
6. 冲突时内置规则包优先于订阅规则，自定义规则优先于两者。

订阅内容只在本地下载与解析，不会上传任何浏览数据；请求直接发往你填写的地址。列表版权与许可证归各自维护者所有。

## 批量扫描

控制台 →「批量扫描」：

1. **快扫**（推荐）：直接抓取网页 HTML 做结构分析，几百个站点几分钟内完成，不打开标签页。对服务端渲染的站点（搜索引擎、门户、博客、下载站、成人站）效果好。
2. **渲染扫描**：后台静默打开标签页等待渲染后再分析，能覆盖 YouTube / Reddit / LinkedIn 这类 JS 渲染站点，但更慢、更占内存。
3. 站点来源：收藏夹（可按文件夹筛选）或粘贴网址列表。
4. 勾选「AI 复核」会调用 AI 逐站分析（消耗额度，受「单次扫描最多调用次数」限制）。
5. 结果进入「本次识别结果」，勾选后「应用选中为规则（本站）」或「应用为通用规则」。

扫描默认跳过 3 天内扫过的站点，可在面板中取消。

## 规则

内置 **35 个规则包、7100+ 条规则**（按油猴脚本常见的去广告覆盖范围整理，并合并了 EasyList / EasyPrivacy / AdGuard / uBlock Origin / CJX / 1Hosts / Peter Lowe 等开源列表，见 [docs/oss-sources.md](docs/oss-sources.md)），可在控制台按需开关：

| 分组 | 规则包 | 覆盖 |
| --- | --- | --- |
| 通用拦截 | 核心拦截 | 通用广告位元素 + Google/DoubleClick/Xandr/Criteo 等 49 个投放域名，Taboola/Outbrain/MGID/Dable 等内容广告容器，AMP 广告组件 |
| | 广告联盟 | Taboola/Outbrain/MGID/Revcontent/百度联盟/广点通/穿山甲/Adsterra，以及 Ezoic/Freestar/AdThrive/Mediavine 等站点托管联盟 |
| | 弹窗骚扰 | Cookie 同意框（含 Funding Choices/Complianz/CookieYes/TrustArc 等）、登录墙、付费墙、邮件订阅、App 下载浮层、通知许可诱导 |
| | 长尾站点通用 | 小说/漫画/小型站点模板的经典广告位与广告弹层 |
| | 开源合并规则 | EasyList / EasyPrivacy / AdGuard / uBlock / CJX / 1Hosts / Peter Lowe 去重合并（纯域名拦截 + 站点级外观规则） |
| 区域站点 | 日本站点 | Yahoo! JAPAN、はてな、価格.com、5ch、ニコニコ、Ameba、FC2 + i-mobile/nend/fluct 等联盟 |
| | 韩国站点 | Naver、Daum、DCInside、Clien、Ruliweb、Tistory + Naver/Kakao/AdPopcorn/Cauly 等广告平台 |
| | 俄罗斯 / 独联体 | Yandex、Mail.ru、Rambler、RIA、Lenta、Habr、VK + AdFox/AdRiver/Relap/SMI2 |
| | 欧洲站点 | Le Figaro、Bild、Spiegel、El País、Corriere、Daily Mail、Guardian、Le Monde 等 + Improve Digital/Permutive/ID5 |
| | 东南亚站点 | VnExpress、Dân trí、Kenh14、Kompas、Detik、Pantip、Kaskus + AdFlex/Innity/Adtima/Adsota |
| | 印度站点 | Times of India、NDTV、News18、Firstpost 等 + Adgebra/Vserv/Tyroo |
| | 拉美站点 | UOL、R7、Clarín、Infobae、El Universal、Globo 等门户广告位 |
| | 港澳台站点 | 痞客邦、聯合報、ETtoday、巴哈姆特、HK01、自由时报、Mobile01 + ClickForce/TenMax |
| 搜索/社交/社区 | 搜索引擎广告 | Google/Bing/百度/搜狗/360/DuckDuckGo/Yandex 结果页推广位 |
| | 国内社交资讯 | 微博、小红书、豆瓣、贴吧、今日头条、网易/新浪/腾讯/凤凰/搜狐 |
| | 海外社交 | X (Twitter)、Facebook、Instagram、TikTok、Pinterest、Quora、Medium |
| | 论坛 / BBS | Discuz / phpwind 通用广告位（`#ad_headerbanner` 等）、虎扑、NGA |
| 视频/直播 | YouTube | 首页/搜索/播放页广告位 + 视频内广告自动跳过 + 反拦截弹窗 |
| | 国内视频 | B站、爱奇艺、腾讯视频、优酷、芒果TV、抖音/西瓜/快手 |
| | 直播平台 | 斗鱼、虎牙、B站直播、Twitch |
| 资讯/技术/电商 | 资讯原生广告 | 信息流原生广告、软文推广、内文广告 |
| | 技术社区 | CSDN、掘金、博客园、简书、SegmentFault/51CTO/开源中国 |
| | 电商平台 | 淘宝天猫、京东、Amazon、eBay、AliExpress 推广位 |
| 影音娱乐 | 音乐 / 音频 | Spotify、SoundCloud、Last.fm、网易云、QQ音乐、酷狗、酷我 |
| | 游戏 / 电竞 | IGN、GameSpot、Polygon、游民星空、3DM、游侠、17173、Fandom、NexusMods |
| | 体育站点 | ESPN、Bleacher Report、Flashscore、直播吧、懂球帝、新浪/腾讯/网易体育 |
| 生活服务 | 财经 / 股票 | 新浪财经、东方财富、同花顺、雪球、和讯、Yahoo Finance、MarketWatch |
| | 旅游 / 出行 | 携程、去哪儿、马蜂窝、Booking、Agoda、Airbnb、Trip.com、TripAdvisor |
| | 教育 / 学术 / 文档 | 知网、道客巴巴、豆丁、百度文库、360doc、Coursera、ResearchGate |
| | 工具 / 网盘 / 天气 | 中国天气网、AccuWeather、快递100、站长之家、MediaFire、4shared、115、蓝奏云 |
| 垂直站点 | 知乎 | 信息流广告卡、推荐位、App 引导、登录弹窗 |
| | Reddit | 推广帖、评论区广告、侧栏广告 |
| | LinkedIn | Sponsored 推广动态、侧栏广告、推广卡 |
| | 资源/下载站 | 假下载按钮、「高速下载」诱导、下载区广告 |
| | 成人站点 | ExoClick/JuicyAds/TrafficJunky 等联盟、弹窗/弹底、信息流广告 |

- **自定义规则**：三条途径——元素选取器、AI 识别、批量扫描，也可以手动导入。
- 规则格式与 Adblock 语法支持范围见 [docs/rules-format.md](docs/rules-format.md)。
- 选择器一律做「词边界」处理（`[class^='ad-slot'], [class*=' ad-slot']` 而不是 `[class*='ad-slot']`），避免误伤 `download-slot`、`dropdown-admin` 这类正常类名；校验脚本会拦截违规写法。
- 放行某元素：用选取器选中后在面板点「在此站放行同类元素」，即生成一条 `#@#` 语义的例外规则。

### 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 选取元素屏蔽 | `Alt+Z`（macOS 为 `Option+Z`） |
| AI 识别本页 | `Alt+A` |

## 目录结构

```
manifest.json            扩展清单（Chrome/Firefox 双 background 声明，可直接加载）
_locales/                商店文案（扩展名称、描述、快捷键说明）
i18n/                    界面多语言：i18n.js（运行时）+ dict-en*.js（中→英词典）
background/              服务工作线程：规则编译、DNR 同步、AI、扫描、消息路由
  rule-format.js         规则格式、Adblock 解析/导出、校验
  rule-index.js          域名索引、CSS 生成、DNR 编译
  dnr.js                 动态规则同步（含降级策略）
  ai*.js                 提示词与 OpenAI 兼容客户端
  scanner.js             收藏夹/列表批量扫描调度
  profiles.js            保护档位定义（兼容/标准/严格）
  learn.js               选择器模式学习与通用化
  autopilot.js           自主增强：浏览记录聚合 + 本地模型复核
  sniffer.js             m3u8/mpd 请求嗅探（按标签页记录）
content/                 内容脚本：CSS 应用、启发式检测、弹窗守护、YouTube、选取器、纯净浏览/阅读模式、图片与网盘收集
rules/pack-*.json        35 个内置规则包（通用/区域/社交/视频/资讯/影音/生活/垂直）
ui/                      popup + 控制台（规则/订阅/AI/扫描/待审/统计）+ 下载工具箱（视频/图片/网盘/下载器）
scripts/                 图标生成、语法检查、规则校验、编译自测、打包、Safari 转换
```

## 开发

纯 JavaScript，无构建依赖直接加载源码目录即可调试。

```bash
npm run check       # 语法检查 + manifest 引用完整性 + 规则包 id 校验 + 中英文案完整性
npm run validate    # 规则包内容校验 + 引擎编译校验（选择器安全性、DNR 预算）
npm run selftest    # 沙箱自测：规则解析/导入导出/DNR 编译/档位/订阅/AI/自动学习/权限（185 条断言）
npm test            # 以上三项
npm run icons       # 重新生成图标（无第三方依赖的 PNG 编码器）
npm run i18n        # 只跑文案完整性检查，列出缺失译文
npm run import:lists # 重新下载合并开源过滤列表，生成 rules/pack-oss.json
npm run build       # 生成 dist/{chrome,firefox,safari} 与 zip/xpi
```

修改规则包后务必运行 `npm test`。

## 已知限制

- 视频内广告（YouTube）采用静音 + 快进 + 跳过的组合策略，极少数直播/长广告可能仍有一瞬画面。
- 快扫看不到 JS 动态插入的广告；渲染扫描受页面加载超时（默认 20s）限制。
- 部分站点有反广告拦截检测。扩展会自动回落档位（兼容 → 临时放行），也可以手动在弹窗里切换；站点兼容性清单见 [docs/compatibility.md](docs/compatibility.md)。
- 订阅列表体量很大时（如 AdGuard Base），网络拦截规则会受动态规则预算截断；外观规则不受限制。订阅更新依赖 `alarms`，浏览器长时间未启动时会在下次启动后补一次检查。
- 隐藏 Cookie 同意框不会替你完成授权，少数站点可能因此限制部分功能（可在该站点停用「弹窗骚扰」包）。
- 单站点请求拦截数是按规则域名命中**估算**的（浏览器不提供 DNR 命中明细给普通扩展）。
- `webRequest` 仅用于计数，扩展不会读取、存储或上传任何请求内容。
- 「自主增强」需要 `history`（浏览记录）权限：扩展只在本地按域名聚合访问次数，用于挑选需要优化的站点；该模式**只允许本地模型**，填写云端 API 地址时不会启动。
- 「严格」档会移除广告容器并强制解锁滚动，个别站点可能功能异常，遇到时用弹窗里的「临时解除」或切回「兼容」。
- 视频嗅探支持 AES-128 加密的 m3u8；SAMPLE-AES/DRM 流无法下载。TS 分片不做转码，播放器若需要 mp4 可用 `ffmpeg -i in.ts -c copy out.mp4` 转封装。
- 下载器的多线程分段依赖服务器支持 `Range`，单文件上限 800MB，任务运行期间需保持工具箱页面打开；普通模式由浏览器接管，可关闭页面、支持断点续传。
- 阅读模式/图片/下载工具箱的文件只会写入 `下载` 目录下的 `ZeroZen/` 子目录，不会碰其他文件。

## 多语言

界面语言跟随浏览器：中文浏览器显示中文，其余语言显示英文；也可以在「规则 → 界面语言」里固定为「跟随浏览器 / 简体中文 / English」。

译文放在 `i18n/dict-en.js`（扩展页面与后台）和 `i18n/dict-en-content.js`（内容脚本），**key 就是代码里的中文原文**，所以新增文案只需要在词典里加一行。`npm run check` 会检查：任何带中文的字符串字面量都必须有译文，且译文里的 `$1/$2` 占位符要和原文一致。不需要翻译的中文（广告检测关键词、下载目录名、网盘品牌名）登记在 `i18n/not-translated.json`。

`_locales/{en,zh_CN}/messages.json` 只放扩展名称、描述与快捷键说明这几条商店要用的文案，`default_locale` 设为 `en`。

## 权限与隐私

安装时只申请广告屏蔽必需的权限（`storage` / `declarativeNetRequest` / `scripting` / `tabs` / `webNavigation` / `contextMenus` / `alarms` / `activeTab` 与 http(s) 主机权限）。

`bookmarks`（批量扫描读收藏夹）、`history`（自主增强）、`downloads`（阅读保存 / 视频 / 图片 / 下载器）、`webRequest`（拦截计数与视频嗅探）改为**按需申请**：第一次用到对应功能时才弹窗，控制台 →「统计与诊断」→「可选权限」里可以随时查看和收回。

扩展没有后端服务器，不收集、不上传任何浏览数据。完整说明见 [docs/privacy-policy.md](docs/privacy-policy.md)，上架材料见 [docs/store-listing.md](docs/store-listing.md)。

## 许可

内置规则包为原创整理，可按需修改。`开源合并规则` 由 `npm run import:lists` 从 EasyList、EasyPrivacy、AdGuard、uBlock Origin、CJX、1Hosts、Peter Lowe 等开源列表自动转换、去重、截断生成，各列表版权与许可证见 [docs/oss-sources.md](docs/oss-sources.md)。

站点兼容性与档位建议见 [docs/compatibility.md](docs/compatibility.md)。

下载工具箱、纯净浏览与阅读模式的文件命名会去掉常见站点后缀（如「 - 哔哩哔哩」「 | YouTube」），也可以在工具面板里手动修改。

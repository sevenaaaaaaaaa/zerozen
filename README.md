<div align="center">

# 零真 · ZeroZen

**跨浏览器广告与弹窗净化扩展 — 规则引擎 + AI 识别 + 断点续传下载工具箱**

装上即净:41 个规则包、7283 条规则本地拦截;规则覆盖不到的,交给 AI 识别;顺手把视频也存下来。

[![Version](https://img.shields.io/badge/version-0.8.1-2f6bff)](https://github.com/sevenaaaaaaaaa/zerozen/releases)
[![Rules](https://img.shields.io/badge/rules-41%20packs%20·%207283-1fa971)](#-核心能力)
[![Chrome](https://img.shields.io/badge/Chrome%20%2F%20Edge%20%2F%20Arc-MV3-4285F4)](#-快速上手)
[![Firefox](https://img.shields.io/badge/Firefox-128%2B-FF7139)](#-快速上手)
[![Safari](https://img.shields.io/badge/Safari-macOS%2013%2B-0FB5EE)](#-快速上手)
[![License](https://img.shields.io/badge/license-MIT-grey)](#license)
[![i18n](https://img.shields.io/badge/中文%20%2F%20English-双语-9b59b6)](#-多语言)

纯本地运行 · 无后端 · 不收集不上传任何浏览数据

[快速上手](#-快速上手) · [核心能力](#-核心能力) · [定位说明](#-定位说明) · [使用指南](#-使用指南) · [当前边界](#-当前边界)

English: [README.en.md](README.en.md)

</div>

---

## 这是什么

打开一个资讯站,先看到的是弹窗、浮层、信息流里的"内容";想下载个视频,又要在层层诱导按钮里找出真链接。零真把这两件事一起解决:**规则引擎负责把广告和弹窗清干净,AI 识别负责补规则覆盖不到的新花样,下载工具箱负责把视频完整存下来**。

它是一个纯本地扩展:没有服务器、没有账号,拦截由浏览器自带的 `declarativeNetRequest` 引擎完成,扩展本身看不到任何请求内容。规则内置 41 个包、7283 条,覆盖中 / 日 / 韩 / 俄 / 欧 / 东南亚 / 印度 / 拉美 / 港澳台站点,也可以订阅 EasyList / EasyPrivacy / anti-AD / AdGuard / uBlock / CJX 等 10 个预设源自动更新。

遇到规则没见过的原生广告或假下载按钮?AI 识别把你填的任意 OpenAI 兼容接口(OpenAI / DeepSeek / 智谱 / 通义 / 硅基流动 / 本地 Ollama)请出来,只发送元素的结构化描述,不传网页正文、不截图、不传 Cookie——默认关闭,你开了才算数。

## 核心能力

- **四层协同净化** — 网络层 `declarativeNetRequest` 拦截 + 外观层 CSS 隐藏/移除 + 弹窗守护(劫持无手势 `window.open`)+ 信息流空位自动回填,不留空洞
- **41 规则包 · 7283 条规则** — 按分组独立开关,选择器做词边界处理不误伤正常类名;冲突时自定义规则 > 内置包 > 订阅规则
- **AI 自主识别** — 你自己填的 OpenAI 兼容接口识别规则覆盖不到的原生广告与假下载按钮;带缓存(同元素 14 天)与限额,结果先进「待审」
- **点选即规则** — `Alt+Z` 选中页面元素直接生成隐藏 / 移除 / 放行规则;从 AI 结果与批量扫描自动学习选择器,多站点复现自动通用化
- **规则订阅** — 10 个预设源,条件请求自动更新、备用地址自动切换;Adblock / hosts / 纯域名 / JSON 四种格式通吃
- **下载工具箱** — 视频嗅探(不点播放也能发现)→ m3u8 解密合并(AES-128)→ 分片级断点续传(IndexedDB 持久化)→ 按类型自动归档 `ZeroZen/`;后台执行,关掉弹窗不中断
- **阅读模式与纯净浏览** — 一键提取正文,收束动画后进入无干扰阅读;一键隐藏导航 / 侧栏 / 评论
- **内网友好** — 私网 / NAS / 路由器后台 / 在线文档(飞书、腾讯文档、Notion……)默认不启用,管理后台与文档编辑零干扰

<details>
<summary><b>📋 规则包分组一览(41 包全览见控制台,点击展开)</b></summary>

| 分组 | 覆盖举例 |
| --- | --- |
| 通用拦截 | 通用广告位 + 49 个投放域名;Taboola/Outbrain/百度联盟/Adsterra;Cookie 同意框/登录墙/付费墙/App 浮层 |
| 搜索/社交 | Google/百度/Bing 推广位;微博/小红书/豆瓣/贴吧/头条;X/Facebook/TikTok;知乎/Reddit/LinkedIn/Discuz 论坛 |
| 视频/直播 | YouTube 播放内广告自动跳过;B站/爱奇艺/优酷/抖音/快手;斗鱼/虎牙/Twitch |
| 资讯/电商 | 信息流原生广告;CSDN/掘金/博客园;淘宝/京东/Amazon;hao123/2345 浮层;AI 导航站推广卡 |
| 影音/游戏/体育 | Spotify/网易云/QQ音乐;IGN/游民星空/3DM;ESPN/直播吧/懂球帝 |
| 生活服务 | 东方财富/同花顺;携程/Booking/马蜂窝;知网/百度文库;美团/饿了么弹窗;百度网盘/夸克会员弹窗 |
| 区域站点 | 日本/韩国/俄罗斯/欧洲/东南亚/印度/拉美/港澳台:Yahoo!JAPAN、Naver、Yandex、Bild、VnExpress、巴哈姆特/HK01 等 |
| 垂直站点 | 资源下载站假高速按钮;成人站联盟(ExoClick/JuicyAds) |

</details>

**隐私承诺**:无后端,不收集不上传任何浏览数据;网络拦截由浏览器 `declarativeNetRequest` 完成,扩展看不到请求内容;`bookmarks` / `history` / `downloads` / `webRequest` 安装时不申请,第一次用到才询问、随时收回;AI 识别只发元素描述与页面地址标题,不上传正文、不截图、不传 Cookie(完整说明见 [docs/privacy-policy.md](docs/privacy-policy.md))。

## 快速上手

### Chrome / Edge / Brave / Arc(要求 Chrome 105+)

1. 下载本仓库或 `git clone https://github.com/sevenaaaaaaaaa/zerozen.git`
2. 打开 `chrome://extensions` → 右上角开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择 **`dist/chrome`**(或仓库根目录)
4. Chrome Web Store 版本审核中,上架后可直接安装

### Firefox(要求 128+)

「临时载入附加组件」选 `dist/firefox/manifest.json`;长期使用安装 `dist/zerozen-firefox-0.8.1.xpi`(Firefox 请用 dist 产物,根目录清单是 Chrome MV3 专用)。

### Safari(macOS 13+ / iOS 16.4+)

```bash
npm run build          # 生成 dist/safari
npm run build:safari   # 转成 Xcode 工程
```

Xcode 中 Run 一次后,Safari → 设置 → 扩展 → 勾选零真并允许访问所有网站。

**装完先记住两个快捷键**:<kbd>Alt+Z</kbd> 点选元素屏蔽 · <kbd>Alt+A</kbd> AI 识别本页。

## 定位说明

零真是芭乐派产品矩阵里的**独立引流品**,归入**第三层:Studio 套件**。矩阵的分层是:

- **OpenFlow = 入口层**:TIPS all-in-one,让一人团队(OPC)与中小团队低门槛完成数字化 + AI 化。
- **Flow 家族 = 进阶层**:MFlow / inFlow / UserLoop / PayFlow / LearnFlow / WebsFlow 按需进阶,各自深耕一个业务场景。
- **Studio 套件 = 本地工具层**:ZeroZen、ThirdC(知识工作台)、V2HTML(视频⇄内容引擎)、InputFlow(隐私输入法)等,偏本地工具、吸引更多用户,长期方向是**作为工作台打通所有 Flow 产品**。

作为引流品,零真的定位是**给所有人立即可用的浏览器刚需工具**:不依赖矩阵任何产品,不要求注册,不引导转化;它代表矩阵「本地优先、诚实边界」的产品观。功能免费,觉得好用可以在控制台配置的支持链接付费(诚实付费)。

## 使用指南

完整使用指南(安装启用 / 净化档位与白名单 / 自定义规则与订阅 / AI 识别配置 / 下载工具箱)见 [docs/USAGE-GUIDE.md](docs/USAGE-GUIDE.md)。
规则格式与兼容性说明:[docs/rules-format.md](docs/rules-format.md) · [docs/compatibility.md](docs/compatibility.md) · 隐私承诺:[docs/privacy-policy.md](docs/privacy-policy.md)。

## 当前边界

- **不是无限拦截**:快扫看不到 JS 动态插入的广告;YouTube 视频内广告用静音 + 快进 + 跳过组合策略,极少数直播 / 长广告可能有一瞬画面;遇反广告拦截墙自动回落档位(清单见 [docs/compatibility.md](docs/compatibility.md))
- **下载有边界**:m3u8 支持 AES-128,SAMPLE-AES / DRM 无法下载;多线程分段需服务器支持 `Range`,上限 2GB;后台任务由工具箱标签页执行,关闭该页下载暂停(进度保留)
- **AI 识别要自己带 key**:默认关闭;只有你主动启用才发请求,直接发往你填写的地址
- **上架进行中**:Chrome Web Store 审核中;Firefox 长期使用请装 dist 产物;Safari 16.4 以下仅外观规则、无收藏夹接口

## License

[MIT](LICENSE) · 内置规则包为原创整理;「开源合并规则」由 `npm run import:lists` 从 EasyList / EasyPrivacy / AdGuard / uBlock Origin / CJX / 1Hosts / Peter Lowe 自动转换生成,各列表版权与许可证见 [docs/oss-sources.md](docs/oss-sources.md)。

---

<div align="center">

**如果零真帮到了你,点个 ⭐ Star 让更多人看到**

</div>

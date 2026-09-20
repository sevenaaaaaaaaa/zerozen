# 规则格式

ZeroZen 的规则分三类：**网络规则**（拦截/放行请求）、**外观规则**（隐藏/移除元素、放行例外）、**文案规则**（按元素短文本匹配，用于「高速下载」这类迷惑性按钮）。

## 1. 原生 JSON 格式

导出文件（`.json`）与导入解析都使用这个结构：

```json
{
  "format": "zerozen-rules",
  "version": 1,
  "exportedAt": "2026-09-20T00:00:00.000Z",
  "rules": [
    {
      "id": "r_abc123",
      "kind": "network",
      "action": "block",
      "filter": "||ads.example.com^",
      "domains": [],
      "excludeDomains": [],
      "resourceTypes": ["script", "image", "xmlhttprequest", "sub_frame", "media", "stylesheet", "font", "object", "ping", "other"],
      "thirdParty": true,
      "enabled": true,
      "source": "user",
      "note": "示例广告域",
      "createdAt": 1758326400000
    },
    {
      "kind": "cosmetic",
      "action": "hide",
      "selector": ".article-ad",
      "domains": ["news.example.com"]
    },
    {
      "kind": "cosmetic",
      "action": "remove",
      "selector": "div[data-ad-slot]"
    },
    {
      "kind": "cosmetic",
      "action": "allow",
      "selector": ".ad-banner",
      "domains": ["good.example.com"]
    },
    {
      "kind": "text",
      "action": "hide",
      "text": "高速下载",
      "tag": "a"
    }
  ]
}
```

导入时也接受裸数组 `[{...}]` 或 `{"rules":[{...}]}`，多余字段会被忽略。

### 字段说明

| 字段 | 适用 | 说明 |
| --- | --- | --- |
| `kind` | 全部 | `network` / `cosmetic` / `text`，缺省时按 `selector` 是否存在推断 |
| `action` | 全部 | network：`block`（默认）或 `allow`；cosmetic/text：`hide`（默认）、`remove`、`allow`（例外） |
| `filter` | network | 匹配模式，支持 `\|\|domain^`、`\|http://...`、`*` 通配、`^` 分隔符 |
| `regexFilter` | network | 正则，必须写成 `/pattern/` 形式（编译时自动去掉斜杠） |
| `selector` | cosmetic | CSS 选择器，支持 `:has()`；禁止 `{ } ; @ url(`、`body *`、裸标签等过宽写法 |
| `text` + `tag?` | text | 元素短文本包含该字符串即命中，`tag` 限定标签（如 `a`、`button`） |
| `domains` | 全部 | 生效站点，空数组 = 所有站点；支持子域名匹配（`example.com` 覆盖 `www.example.com`） |
| `excludeDomains` | 全部 | 排除站点，优先级高于 `domains` |
| `thirdParty` | network | `true` 只拦第三方请求，`false` 只拦第一方 |
| `resourceTypes` | network | 缺省覆盖除 `main_frame` 外的全部类型（**永远不拦导航请求**） |
| `priority` | network | ≥105 的 block 规则会压过 allow 例外（对应 Adblock 的 `$important`） |
| `enabled` | 全部 | `false` 时规则保留但不生效 |
| `source` | 全部 | `builtin`/`user`/`ai`/`scan`/`import`，仅用于展示与筛选，导入时自动改写 |

### 例外规则

- 网络例外：`action: "allow"` + 同样的 `filter`，编译为高优先级 DNR allow 规则（优先级 100，高于普通 block）。
- 外观例外：`action: "allow"` + `selector`，会把同名选择器从该站点的隐藏列表里剔除（等价于 Adblock 的 `#@#`）。
- 站点排除：`excludeDomains` 让一条通用规则在指定站点失效。

## 2. Adblock 语法子集

导入时自动识别（文本里含 `##`、`#@#`、`@@`、`||` 等即按 Adblock 解析）。**纯域名列表**（一行一个域名）也可以直接粘贴，会自动转成 `||domain^`。

### 支持的写法

| 写法 | 说明 |
| --- | --- |
| `\|\|ads.example.com^` | 域名及子域名 |
| `\|\|ads.example.com^$third-party,script` | 限定第三方 + 资源类型 |
| `\|\|ads.example.com^$domain=a.com\|b.com` | 只在指定站点生效 |
| `\|\|important.example.com^$important` | 高优先级拦截（可压过例外） |
| `@@\|\|ads.example.com/ok^` | 网络例外 |
| `/banner\d+/` | 正则（首尾都是 `/`） |
| `example.com##.ad-banner` | 站点外观规则 |
| `example.com,news.example.com##.sponsor-box` | 多站点 |
| `~excluded.example.com##.everywhere-ad` | 排除某站点 |
| `##.global-ad` | 全站外观规则 |
| `example.com#@#.ad-banner` | 外观例外 |
| `example.com##.ad:has(.inner)` | 选择器支持 `:has()` |

### 会跳过并报告的写法

`$csp=`、`$popup`、`$document`、`$rewrite=`、`$redirect=`、`$removeparam=`、`#?#`/`#$#` 扩展语法、`example.*` 实体域名。导入后界面会显示跳过条数与原因（前若干条）。

## 3. 导出

- **导出 JSON**：完整原生格式，可再次导入，跨设备迁移用这个。
- **导出 Adblock**：转成 `||filter` / `domain##selector` 文本，可粘贴到其他支持 Adblock 语法的工具。
- **复制 JSON**：方便直接分享。

导出只包含自定义规则（内置规则包随扩展版本更新，不参与导出）。可按来源筛选后导出。

## 4. 校验与安全

- 所有选择器在写入前经过 `validateSelector`：拒绝 CSS 注入字符、拒绝 `body`/`html`/`*`/`body *` 这类覆盖整页的写法、拒绝裸标签（自定义元素带 `-` 除外）、拒绝超过 6 层 `>` 的深链路。
- **子串选择器必须做词边界拆分**：`[class*='ad-slot']` 会同时命中 `download-slot`、`upload-slot`；`[class*='down-ad']` 会命中 `dropdown-admin`。校验脚本会直接拒绝这类写法，正确写法是拆成两条：
  - `[class^='ad-slot']`（作为第一个 class）
  - `[class*=' ad-slot']`（作为中间/末尾 class，前面有空格）
  作为作用域前缀时用 `:is([class^='down-box'], [class*=' down-box']) [class^='ad-']`。
  判断规则：值以 `ad-`/`ad_`/`ads-`/`ads_` 开头，或首段词属于 `ad/down/load/read/head/thread/bread/spread/upload/add/side/wide/mask/banner/fixed` 且值里含分隔符。
- 网络规则的 `urlFilter` 必须是 ASCII、无空白、长度 < 2000，且不会作用于 `main_frame`。
- 动态规则有数量上限（Chrome/Firefox 默认预算 4500 条，可配置）。超出上限时按「用户规则 → AI → 扫描 → 导入 → 内置」的顺序保留，并在控制台「统计与诊断」里显示丢弃数量；若浏览器拒绝正则规则，会自动降级为不含正则的规则集。
- 选取器与 AI 生成的选择器在应用前会用实际页面校验匹配数量：本站规则匹配超过 400 个元素、通用规则超过 200 个元素时拒绝写入。

## 5. 编写建议

- 优先用 `id` 或语义化 class，避免 `nth-child` 之类易变的结构选择器。
- 站点规则一律用 `domains` 限定作用域；跨站点通用的模式才留空。
- 广告位通常有多个同类兄弟节点，用可复用的 class 选择器一次覆盖，而不是逐个 ID。
- 同一站点多个广告位建议合并成少量规则，减少 CSS 体积与计数开销。
- 站点选择器会随改版失效，这是正常的：用 AI 识别或元素选取器补一条即可，不必删除原有规则。
- 想临时放行某元素，不要删除规则——用选取器的「放行」生成例外规则，升级规则包时不会被覆盖。

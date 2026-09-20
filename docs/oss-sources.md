# 开源规则来源

生成时间：2026-09-20（`npm run import:lists` 可重新生成）

| 来源 | 许可证 | 解析 | 保留域名规则 | 保留外观规则 |
| --- | --- | --- | --- | --- |
| EasyList | GPLv3 / CC BY-SA 3.0 | 77856 | 50291 | 9749 |
| EasyPrivacy | GPLv3 / CC BY-SA 3.0 | 56093 | 47051 | 25 |
| EasyList China | GPLv3 / CC BY-SA 3.0 | 18195 | 5899 | 5285 |
| AdGuard Base filter | GPLv3 | 124527 | 62362 | 34628 |
| AdGuard Chinese filter | GPLv3 | 20922 | 6160 | 7059 |
| uBlock Origin filters (uAssets) | GPLv3 | 3843 | 134 | 3075 |
| CJX's Annoyance List | GPLv3 | 1807 | 162 | 1049 |
| 1Hosts (Lite) | MPL-2.0 | 102259 | 102079 | 0 |
| Peter Lowe's Ad and tracking server list | 免费个人使用（见 pgl.yoyo.org） | 3554 | 3444 | 0 |

合并结果：`rules/pack-oss.json`（网络 3200 条 / 外观 2600 条）。

说明：
- 只合并纯域名拦截规则（`||domain^`）与站点级外观规则，避免误伤与预算膨胀；
- 与内置 34 个规则包做了去重，且所有选择器都通过 `scripts/rule-guard.mjs` 的安全校验；
- 列表内容遵循各自许可证，本扩展仅做格式转换、去重与截断；如需转载，请保留上表来源与许可证信息。

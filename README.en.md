# ZeroZen Ad Cleaner

[中文文档](README.md)

A cross-browser (Chrome / Firefox / Safari) ad and popup blocker: **rule engine + AI detection + bulk bookmark scanning**, with custom rule import/export.

Ships with 35 rule packs and 7100+ rules (deduplicated and merged from EasyList / AdGuard / uBlock and other open lists), covering search engines, video and live-streaming sites, social platforms, forums, developer communities, marketplaces, download sites, adult sites, and regional sites across Japan, Korea, Russia, Europe, South-East Asia, India, Latin America and Greater China.

## Features

| Capability | What it does |
| --- | --- |
| Network blocking | Dynamic `declarativeNetRequest` rules block ad networks, tracking domains and ad endpoints |
| Cosmetic cleaning | CSS hiding plus DOM removal for ad slots, feed ads and sticky overlays |
| Popup guard | Hijacks gesture-less `window.open` and notification prompts in the page world; stops pop-unders and redirect hijacks |
| YouTube | Hides home/watch ad slots, skips in-video ads, suppresses anti-adblock dialogs |
| AI detection | Sends a **structured description** of page elements to your own OpenAI-compatible endpoint to catch native ads, fake download buttons and site-specific popups, then writes CSS rules |
| Element picker | `Alt+Z` or the context menu to click an element and turn it into a rule (hide / remove / allow, this site or everywhere) |
| Rule subscriptions | Subscribe to EasyList, anti-AD, AdGuard and any other http(s) filter list; refreshed on a schedule with conditional requests and mirror fallback |
| Bulk scan | Read your bookmarks or paste a site list, then fast-scan (raw HTML) or rendered-scan (silent background tabs) to generate per-site rules, optionally reviewed by AI |
| Rule management | Toggle each built-in pack; import custom rules as JSON, a subset of Adblock syntax or a plain domain list; export as JSON or Adblock text |
| Protection levels | Compatible / Standard / Strict, per site from the popup |
| Temporary pause | Allow the current site for N minutes (30 by default), restored automatically |
| Anti-adblock fallback | Detects multilingual anti-adblock walls and drops to Compatible, then to a temporary pause, so pages keep working |
| Autopilot | Finds frequently visited sites in your history and optimises rules for them; **local models only** (Ollama / LM Studio) — nothing leaves your machine |
| Auto-learning | Learns selector patterns from manual blocks, confirmed AI findings and scan results; promotes a pattern to a generic rule once it shows up on several sites |
| Clean view & reader | Strip navigation, sidebars and overlays, or extract the article into a distraction-free view and save it as Markdown |
| Download toolbox | Sniffs m3u8/mpd streams, finds page images, collects file-host links and access codes, and includes a download manager with multi-threaded ranged downloads |
| Statistics | Per-site counts of hidden elements, blocked requests and blocked popups, with a per-page badge |

## Install

### Chrome / Edge / Brave / Arc

1. Open `chrome://extensions` and turn on Developer mode
2. "Load unpacked" → pick this folder (or `dist/chrome`)
3. Click the toolbar icon → "Open the console"

Requires Chrome 105+.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on" → pick `manifest.json` (or `dist/firefox/manifest.json`)
3. For everyday use install `dist/zerozen-firefox-0.6.0.xpi` from `about:addons`

Requires Firefox 128+.

### Safari (macOS 13+ / iOS 16.4+)

```bash
npm run build          # produces dist/safari
npm run build:safari   # converts it with xcrun safari-web-extension-converter
```

## Language

The interface follows your browser's UI language: Chinese browsers get Chinese, everything else gets English. You can pin it under **Rules → Interface language** (Follow the browser / 简体中文 / English).

Translations live in `i18n/dict-en.js` (extension pages and background) and `i18n/dict-en-content.js` (content scripts). The key of every entry is the Chinese source string, so adding a new string means adding one line to the dictionary; `npm run check` fails when a Chinese string has no translation or when the `$1` placeholders don't line up. Strings that must not be translated (ad-detection keywords, download folder names, brand names) are listed in `i18n/not-translated.json`.

## AI detection

Console → "AI detection": tick "Enable AI detection", then point it at any OpenAI-compatible endpoint (OpenAI, DeepSeek, Zhipu GLM, Qwen, SiliconFlow, or a local Ollama on `http://127.0.0.1:11434/v1`).

**Privacy**: only a structured description of each element is sent (tag name, class, id, size, position, and up to 140 characters of text) plus the page URL and title. Page content, screenshots and cookies are never uploaded, and the short text and attributes can be turned off. Requests go straight to the endpoint you configured — there is no relay.

## Permissions

Requested at install time: `storage`, `unlimitedStorage`, `declarativeNetRequest`, `scripting`, `tabs`, `webNavigation`, `contextMenus`, `alarms`, `activeTab`, and http(s) host access.

Requested on demand, revocable at any time from **Stats & diagnostics → Optional permissions**: `bookmarks` (bulk scan), `history` (autopilot), `downloads` (reader saving, video, images, downloader), `webRequest` (blocking counters and video sniffing).

There is no backend server and no browsing data is ever collected or uploaded. See [docs/privacy-policy.en.md](docs/privacy-policy.en.md).

## Development

Plain JavaScript, no build step — load the source folder directly.

```bash
npm run check       # syntax, manifest references, rule pack ids, i18n completeness
npm run validate    # rule pack contents + engine compilation (selector safety, DNR budget)
npm run selftest    # sandboxed self-test of parsing, import/export, DNR, profiles, subscriptions, AI, learning, i18n
npm test            # all three
npm run build       # produces dist/{chrome,firefox,safari} plus the zip/xpi
```

Run `npm test` after changing any rule pack or user-facing string.

## Licence

The built-in rule packs are original work. The "Merged open-source lists" pack is generated by `npm run import:lists` from EasyList, EasyPrivacy, AdGuard, uBlock Origin, CJX, 1Hosts and Peter Lowe's list; see [docs/oss-sources.md](docs/oss-sources.md) for each list's licence.

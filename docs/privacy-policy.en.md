# ZeroZen Privacy Policy

Last updated: 2026-09-21 · Applies to version 0.7.0 and later · [中文版](privacy-policy.md)

## In one sentence

ZeroZen does not collect, upload or sell any personal data. There is no backend server; rule matching, statistics and learning all happen inside your browser.

## What the extension handles

| Data | Why | Where it lives | Leaves your device? |
| --- | --- | --- | --- |
| The domains of pages you visit | Matching rules, per-site counters, per-site on/off and protection level | Browser local storage (`storage.local`) | No |
| Custom rules, AI findings, scan results | Ad blocking | Browser local storage | No |
| Per-site hidden/blocked counts | The statistics screen | Browser local storage | No |
| Bookmark URLs (only when you click "Read bookmarks") | Source of sites for a bulk scan | Memory and local storage | No |
| Domains and visit counts from your history (only when you enable Autopilot) | Picking frequently visited sites to optimise | Memory; only the aggregate is kept | No |
| A structured description of page elements, plus the page URL and title (only when you enable AI detection) | Asking the model you configured whether an element is an ad | Not written to disk (results cached for 14 days) | **Yes**, to the endpoint you entered |
| Subscription URLs | Downloading open filter lists on a schedule | Browser local storage | **Yes**, a GET request to the list you entered |

The extension never reads, stores or uploads page text, form input, passwords, cookies, request bodies or screenshots.

## The two features that make outbound requests

1. **AI detection (off by default)**: only runs after you enter an OpenAI-compatible endpoint and enable it. What is sent: the element's tag name, class, id, size, position and up to 140 characters of text, plus the current page URL and title as context. The short text and the element attributes can each be switched off. Requests go directly to the address you entered — no relay, and the developer cannot see them.
2. **Rule subscriptions (none by default)**: only after you add a subscription does the extension fetch that URL on your schedule. Requests carry no cookies (`credentials: omit`) and no browsing data; the server sees exactly what it would see if you opened the link yourself.

Autopilot only runs against a local model (Ollama / LM Studio on a loopback address) and refuses to start if the endpoint is a cloud address.

## Permissions

Requested at install time:

| Permission | Why |
| --- | --- |
| `storage` / `unlimitedStorage` | Store rules, settings and statistics |
| `declarativeNetRequest` | Let the browser block ad requests from our rules; the extension never sees request contents |
| `scripting` | Inject the CSS that hides ads |
| `tabs` / `webNavigation` | Know the current tab's address so the right site rules apply |
| `contextMenus` | The "block this element" context menu |
| `alarms` | Check subscriptions for updates on a schedule |
| `activeTab` | Act on the current tab when a keyboard shortcut is used |
| `host_permissions` (http/https) | Ad blocking has to work on whichever site you visit; page content is never read and sent anywhere |

Requested on demand, not at install time, and revocable at any time in the console:

| Permission | Feature | Why |
| --- | --- | --- |
| `bookmarks` | Bulk scan | Reads bookmark URLs and folder names only; never modifies bookmarks |
| `history` | Autopilot | Aggregates visit counts per domain locally |
| `downloads` | Reader saving / video / images / downloader | Writes files into the `ZeroZen/` subfolder of your downloads directory |
| `webRequest` | Blocking counters / video sniffing | Observes request URLs only, to count blocks and spot m3u8/mpd streams; request contents are never read |
| `notifications` | Task completion notifications | Shows a system notification when a download task finishes or fails; sends notifications only |

## Retention and deletion

Everything is local. The console's Stats & diagnostics page can clear statistics and reset settings; uninstalling the extension deletes all of its local data. `storage.sync` is not used, so nothing is synced to your browser account.

## Children's privacy

The extension is not directed at children under 13 and collects no personally identifiable information.

## Changes

Changes to this policy ship with the extension and are tracked in `docs/privacy-policy.en.md`.

## Contact

Questions and reports: <add your email or issue tracker here>

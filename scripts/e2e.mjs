// ZeroZen 端到端实测：真实 Chromium + 加载扩展 + 本地测试页，验证拦截/误拦保护/阅读模式/保存/下载链路。
// 依赖：本机 Chromium 内核浏览器（默认 ego lite，可用 E2E_BROWSER 覆盖）；生成 HLS 需要 ffmpeg（缺失则跳过下载项）。
// 运行：npm run build 后执行 `npm run e2e`。
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const PORT = 9223;
const HTTP_PORT = 9187;
const EXT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "chrome");
const BROWSER_CANDIDATES = [
  process.env.E2E_BROWSER,
  "/Applications/ego lite.app/Contents/MacOS/ego lite",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

// ---------- 极简 CDP ----------
class Conn {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.msgId = 0;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error("ws connect failed"));
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    };
    for (const d of ["Runtime.enable", "Log.enable", "Page.enable"]) {
      await this.send(d).catch(() => {});
    }
    return this;
  }
  send(method, params = {}) {
    const id = ++this.msgId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => this.pending.has(id) && (this.pending.delete(id), rej(new Error("timeout " + method))), 40000);
    });
  }
  async evaluate(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
    return r.result.value;
  }
  close() {
    try {
      this.ws.close();
    } catch (e) {}
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
  return fetch(`http://localhost:${PORT}/json`).then((r) => r.json());
}
async function newTab(url) {
  return fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).then((r) => r.json());
}
async function closeTab(id) {
  await fetch(`http://localhost:${PORT}/json/close/${id}`).catch(() => {});
}
async function swConn() {
  for (let i = 0; i < 10; i++) {
    const ts = await targets();
    const sw = ts.find((x) => x.type === "service_worker" && x.url.includes("background/index.js"));
    if (sw) {
      const c = await new Conn(sw.webSocketDebuggerUrl).connect();
      await c.evaluate("(async () => { await ZZ.Main.init(); })()").catch(() => {});
      return c;
    }
    // 唤醒：导航一个页面触发扩展事件
    const ts2 = await targets();
    const page = ts2.find((x) => x.type === "page" && /^https?:/.test(x.url));
    if (page) {
      const p = await new Conn(page.webSocketDebuggerUrl).connect();
      await p.send("Page.reload").catch(() => {});
      p.close();
    }
    await sleep(2000);
  }
  throw new Error("service worker 未能唤醒");
}

// ---------- 测试页与 HLS 素材 ----------
async function prepareFixtures(dir) {
  const pages = join(dir, "pages");
  mkdirSync(pages, { recursive: true });
  writeFileSync(
    join(pages, "qa.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>QA</title><style>
.fake-login{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
.login-modal{background:#fff;padding:30px;border-radius:8px;width:360px}
</style></head><body>
<h1>QA</h1>
<div data-ad-slot="qa1" id="hideTarget">hidden-by-rule</div>
<a id="fakeDl" href="javascript:void(0)">高速下载</a>
<div class="content"><p>段落一。</p><p>段落二。</p></div>
<div class="fake-login" id="loginOverlay"><div class="login-modal"><h2>登录</h2><input type="email"><input type="password"><button>登录</button></div></div>
<div id="emailModal" style="position:fixed;top:20px;right:20px;width:300px;background:#fff;border:1px solid #ccc;padding:16px"><b>订阅</b><input><button>订阅</button></div>
</body></html>`
  );
  writeFileSync(
    join(pages, "article.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>The History of Tea</title></head><body>
<article><h1>The History of Tea</h1>
<p>Tea is an aromatic beverage prepared by pouring hot boiling water over cured leaves of the Camellia sinensis plant, first consumed in ancient China.</p>
<p>During the Tang dynasty tea culture flourished and spread to Japan; Dutch traders later brought it to Europe in the seventeenth century.</p>
<p>Today tea is the second most consumed drink in the world after water, with ceremonies from Japanese matcha to Indian chai.</p>
</article></body></html>`
  );
  writeFileSync(
    join(pages, "golden.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>Golden</title><style>
.modal{display:none}
.login-modal{display:block;position:relative;width:420px;padding:20px;border:1px solid #ddd;margin:10px}
.email-modal{position:relative;width:300px;padding:12px;border:1px solid #eee;margin:10px}
.overlay-panel{position:relative;width:200px;height:80px;background:#f6f6f6;margin:10px}
</style></head><body>
<div class="login-modal" id="gLogin"><h3>登录</h3><input type="email"><input type="password"><button>登录</button></div>
<div class="email-modal" id="gEmail"><input placeholder="邮箱"><button>订阅</button></div>
<form id="gSearch"><input type="search"><button>搜索</button></form>
<div class="overlay-panel" id="gOverlay"><button>关闭</button></div>
<div class="player" id="gPlayer"><video src="about:blank"></video></div>
<div class="cart" id="gCart"><button>加入购物车</button><span>￥129</span></div>
<div class="comments" id="gComments"><form><textarea></textarea><button>评论</button></form></div>
<div class="popup-login" id="gPopupLogin"><form><input><button>登录</button></form></div>
</body></html>`
  );
  writeFileSync(
    join(pages, "modals.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>Modals</title><style>
body{margin:0;font:14px sans-serif;height:3000px}
.box1{position:fixed;inset:0;z-index:1000;background:transparent;display:flex;align-items:center;justify-content:center}
.box1 .in{background:#fff;border:1px solid #ccc;padding:20px;width:300px}
.lb{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center}
.cookie-bar{position:fixed;left:0;right:0;bottom:0;height:80px;z-index:500;background:#222;color:#fff}
.fade{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.5);opacity:0;transition:opacity 1.2s ease;color:#fff}
.fade.on{opacity:1}
.backdrop{position:fixed;inset:0;z-index:999;background:transparent}
#btns{position:relative;z-index:5000;background:#eee;padding:8px}
.hidden{display:none}
</style></head><body>
<div id="btns"><button id="bOauth">登录 Google</button> <button id="bAsync">异步打开</button> <button id="bCross">打开站外</button> <button id="bMenu">菜单</button> <span id="plain">普通文字区域</span></div>
<div class="box1" id="L1"><div class="in"><p>确认删除这条记录吗？</p><button>取消</button><button>确定</button></div></div>
<div class="lb" id="L3"><img width="200" height="150" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="></div>
<div class="cookie-bar" id="L4">本站使用 Cookie 改善体验 <button>同意</button></div>
<div role="dialog" aria-modal="true" id="L5" style="position:fixed;inset:0;z-index:4000;background:transparent"><div style="margin:100px auto;width:200px;background:#fff">分享到…</div></div>
<a id="A1" href="https://evil-ads.example/landing" style="position:fixed;inset:0;z-index:9999;background:transparent;display:block"></a>
<div id="A2" style="position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.85);color:#fff"><a href="https://shop.example/x"><img width="300" height="200" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="></a><span>广告 5 秒后关闭</span></div>
<div id="A3" style="position:fixed;right:10px;bottom:100px;width:300px;height:250px;z-index:7000;background:#fff"><span>广告</span><a href="https://shop.example/y"><img width="280" height="200" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="></a></div>
<div id="A4" style="position:fixed;left:10px;bottom:100px;width:320px;height:260px;z-index:7000"><iframe width="300" height="250" src="https://googleads.g.doubleclick.net/pagead/ads?x=1"></iframe></div>
<script>
window.__opens = {};
const track = (k, url) => { try { const w = window.open(url, "_blank"); window.__opens[k] = !!w; if (w) w.close(); } catch (e) { window.__opens[k] = "err:" + e.message; } };
document.getElementById("bOauth").onclick = () => track("oauth", "https://accounts.google.com/o/oauth2/auth");
document.getElementById("bAsync").onclick = () => setTimeout(() => track("async", "/pages/article.html"), 2000);
document.getElementById("bCross").onclick = () => track("cross", "https://example.org/");
document.getElementById("bMenu").onclick = () => { const d = document.createElement("div"); d.className = "backdrop"; d.id = "L6"; document.body.appendChild(d); };
document.addEventListener("click", (e) => { if (e.target.id === "plain") track("popunder", "https://popunder.example/"); });
setTimeout(() => { const f = document.createElement("div"); f.className = "fade"; f.id = "L2"; f.textContent = "欢迎回来，这是一条站内公告。"; document.body.appendChild(f); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.add("on"))); }, 2500);
setTimeout(() => track("auto", "https://auto.example/"), 1500);
</script>
</body></html>`
  );
  let hasHls = false;
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    const enc = dir;
    const keyPath = join(enc, "key.bin");
    writeFileSync(keyPath, Buffer.from("0123456789abcdef0123456789abcdef", "hex"));
    // keyinfo 写相对路径 + cwd 指到素材目录：ffmpeg 会把 key URI 原样写进 m3u8，绝对路径会让密钥请求 404
    writeFileSync(join(enc, "keyinfo"), "key.bin\nkey.bin\n000102030405060708090a0b0c0d0e0f\n");
    execSync(
      `ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=320x240:rate=12:duration=8" -f lavfi -i "sine=frequency=440:duration=8" ` +
        `-c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest -g 24 -keyint_min 24 -sc_threshold 0 ` +
        `-f hls -hls_time 2 -hls_list_size 0 -hls_playlist_type vod -hls_key_info_file keyinfo ` +
        `-hls_segment_filename "enc%d.ts" enc.m3u8`,
      { cwd: enc, stdio: "ignore" }
    );
    // 长一点的明文 TS 流：暂停/续传/宿主崩溃恢复用；/prot/ 路径要求 Referer（防盗链）
    execSync(
      `ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=320x240:rate=12:duration=24" -f lavfi -i "sine=frequency=330:duration=24" ` +
        `-c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest -g 12 -keyint_min 12 -sc_threshold 0 ` +
        `-f hls -hls_time 1 -hls_list_size 0 -hls_playlist_type vod -hls_segment_filename "long%d.ts" long.m3u8`,
      { cwd: enc, stdio: "ignore" }
    );
    mkdirSync(join(enc, "prot"), { recursive: true });
    execSync(`cp long*.ts long.m3u8 prot/`, { cwd: enc, stdio: "ignore", shell: "/bin/sh" });
    hasHls = existsSync(join(enc, "enc.m3u8")) && existsSync(join(enc, "long.m3u8"));
  } catch (e) {
    console.log("  (ffmpeg 不可用，跳过 m3u8 下载项)");
  }
  return { hasHls };
}

function serveStatic(root) {
  const server = createServer(async (req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url.startsWith("/prot/") && !String(req.headers.referer || "").includes("/pages/player.html")) {
      res.writeHead(403).end();
      return;
    }
    // 慢速分片：让暂停/中断能落在下载中途
    if (/long\d+\.ts$/.test(url)) await new Promise((r) => setTimeout(r, 900));
    const path = join(root, decodeURIComponent(url));
    if (!path.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = readFileSync(path);
      const ext = path.split(".").pop();
      const mime = { html: "text/html", m3u8: "application/vnd.apple.mpegurl", ts: "video/mp2t", bin: "application/octet-stream" }[ext] || "application/octet-stream";
      res.writeHead(200, { "content-type": mime, "access-control-allow-origin": "*", "cache-control": "no-store" });
      res.end(data);
    } catch (e) {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(HTTP_PORT, () => resolve(server)));
}

// ---------- 主流程 ----------
async function main() {
  const browser = BROWSER_CANDIDATES.find((p) => p && existsSync(p));
  if (!browser) {
    console.log("e2e: 未找到 Chromium 内核浏览器（可用 E2E_BROWSER 指定），跳过");
    process.exit(0);
  }
  if (!existsSync(EXT_PATH)) {
    console.log("e2e: dist/chrome 不存在，请先 npm run build");
    process.exit(1);
  }
  const work = mkdtempSync(join(tmpdir(), "zz-e2e-"));
  const profile = join(work, "profile");
  const outDir = join(work, "dl-out");
  mkdirSync(outDir, { recursive: true });
  const { hasHls } = await prepareFixtures(work);
  // 测试副本：把可选的 downloads 权限放进必需权限（真实用户由点击手势授权，CDP 无法模拟授权弹窗）
  const extCopy = join(work, "ext");
  execSync(`cp -R "${EXT_PATH}" "${extCopy}"`);
  {
    const mf = JSON.parse(readFileSync(join(extCopy, "manifest.json"), "utf8"));
    mf.permissions = Array.from(new Set(mf.permissions.concat(["downloads", "webRequest"])));
    mf.optional_permissions = (mf.optional_permissions || []).filter((x) => x !== "downloads" && x !== "webRequest");
    writeFileSync(join(extCopy, "manifest.json"), JSON.stringify(mf, null, 2));
  }
  const server = await serveStatic(work);

  const proc = spawn(browser, [
    `--user-data-dir=${profile}`,
    `--load-extension=${extCopy}`,
    `--remote-debugging-port=${PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    // CI / 容器环境（root、无桌面）用 E2E_EXTRA_ARGS 追加 --no-sandbox 等参数
    ...String(process.env.E2E_EXTRA_ARGS || "").split(/\s+/).filter(Boolean),
    "about:blank",
  ], { stdio: "ignore" });
  await sleep(6000);

  const ok = [];
  const bad = [];
  const check = (name, cond) => (cond ? ok.push(name) : bad.push(name));
  try {
    const c = await swConn();
    await c.evaluate(`(async () => {
      await ZZ.Store.updateSite("localhost", { enabled: true });
      await ZZ.Main.rebuild({ dnr: true });
    })()`);

    // —— 拦截与误拦保护 ——
    const qa = await newTab(`http://localhost:${HTTP_PORT}/pages/qa.html`);
    await sleep(7000);
    {
      const p = await new Conn(qa.webSocketDebuggerUrl).connect();
      const r = await p.evaluate(`({
        hide: getComputedStyle(document.getElementById("hideTarget")).display === "none",
        dl: (() => { const el = document.getElementById("fakeDl"); return !el || getComputedStyle(el).display === "none"; })(),
        login: document.getElementById("loginOverlay").offsetWidth > 100,
        email: document.getElementById("emailModal").offsetWidth > 100,
      })`);
      check("hide 规则生效", r.hide);
      check("文本规则生效（假下载按钮）", r.dl);
      check("登录弹窗不被隐藏", r.login);
      check("邮箱弹窗不被隐藏", r.email);
      p.close();
      await closeTab(qa.id);
    }

    // —— 阅读模式（后台 tab 直挂）——
    const art = await newTab(`http://localhost:${HTTP_PORT}/pages/article.html`);
    await sleep(4000);
    {
      const p = await new Conn(art.webSocketDebuggerUrl).connect();
      const entered = await c.evaluate(`(async () => {
        const tabs = await chrome.tabs.query({ url: "http://localhost:${HTTP_PORT}/pages/article.html" });
        if (!tabs.length) return false;
        const probe = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => [...document.querySelectorAll("[data-zz-ui]")].some((el) => el.shadowRoot && el.shadowRoot.querySelector(".t")),
        });
        if (!probe[0].result) await chrome.tabs.sendMessage(tabs[0].id, { type: "zz:reader:toggle" });
        await new Promise((r2) => setTimeout(r2, 1500));
        const probe2 = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            const host = [...document.querySelectorAll("[data-zz-ui]")].find((el) => el.shadowRoot && el.shadowRoot.querySelector(".t"));
            if (!host) return null;
            const sr = host.shadowRoot;
            return { junk: sr.querySelectorAll(".body style,.body [style]").length, paras: sr.querySelectorAll(".body p").length };
          },
        });
        return probe2[0].result;
      })()`);
      console.log("  reader entered:", JSON.stringify(entered));
      check("阅读模式挂载（后台 tab）", !!entered);
      check("正文样式净化", !!entered && entered.junk === 0 && entered.paras === 3);

      // —— Markdown 保存（CDP 接管下载目录）——
      const bws = await fetch(`http://localhost:${PORT}/json/version`).then((r) => r.json());
      const bc = await new Conn(bws.webSocketDebuggerUrl).connect();
      await bc.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: outDir });
      const clicked = await p.evaluate(`(() => {
        const host = [...document.querySelectorAll("[data-zz-ui]")].find((el) => el.shadowRoot && el.shadowRoot.querySelector(".t"));
        if (!host) return false;
        const btn = [...host.shadowRoot.querySelectorAll("button")].find((b) => /Markdown/.test(b.textContent));
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      await sleep(3000);
      const saved = execSync(`ls "${outDir}" 2>/dev/null || true`).toString().trim();
      check("Markdown 保存落盘", clicked && saved.length > 0);
      bc.close();
      p.close();
      await closeTab(art.id);
    }

    // —— 下载链路：常驻宿主 + 队列 + Referer 伪装 + 暂停续传 + 宿主崩溃恢复 + TS→MP4 ——
    if (hasHls) {
      const bws = await fetch(`http://localhost:${PORT}/json/version`).then((r) => r.json());
      const bc = await new Conn(bws.webSocketDebuggerUrl).connect();
      await bc.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: outDir });
      const dl = (type, payload) => c.evaluate(`ZZ.DL.handle(${JSON.stringify({ type, payload })})`);
      const waitFor = async (id, pred, ms) => {
        const end = Date.now() + ms;
        let t = null;
        while (Date.now() < end) {
          const res = await dl("zz:dl:list", {});
          t = (res.tasks || []).find((x) => x.id === id);
          if (t && pred(t)) return t;
          await sleep(300);
        }
        return t;
      };
      const base = `http://localhost:${HTTP_PORT}`;

      // AES-128 + TS→MP4
      const a = await dl("zz:dl:add", { url: `${base}/enc.m3u8`, title: "qa-aes", pageUrl: `${base}/pages/qa.html` });
      const ta = await waitFor(a.task && a.task.id, (t) => t.status === "done" || t.status === "error", 30000);
      console.log("  aes task:", ta && ta.status, ta && (ta.error || ta.saved));
      check("m3u8 AES-128 下载完成（常驻宿主）", ta && ta.status === "done");

      // 防盗链 + 暂停 + 续传
      const b = await dl("zz:dl:add", { url: `${base}/prot/long.m3u8`, title: "qa-prot", pageUrl: `${base}/pages/player.html` });
      const idb = b.task && b.task.id;
      await waitFor(idb, (t) => t.progress && t.progress.done >= 5, 20000);
      await dl("zz:dl:pause", { id: idb });
      const tp = await waitFor(idb, (t) => t.status === "paused", 8000);
      const doneAtPause = tp && tp.progress ? tp.progress.done : 0;
      console.log("  paused:", tp && tp.status, JSON.stringify(tp && tp.progress));
      check("暂停后保留进度", tp && tp.status === "paused" && doneAtPause >= 5 && doneAtPause < 24);
      await dl("zz:dl:resume", { id: idb });
      await waitFor(idb, (t) => t.progress && t.progress.done >= doneAtPause + 3, 20000);

      // 模拟浏览器重启：直接关掉宿主，再次访问时自动拉起并续传
      await c.evaluate(`chrome.offscreen.closeDocument().catch(() => {})`);
      await sleep(800);
      const tb = await waitFor(idb, (t) => t.status === "done" || t.status === "error", 40000);
      console.log("  prot task:", tb && tb.status, tb && (tb.error || tb.saved));
      check("防盗链 Referer 伪装 + 续传 + 宿主崩溃自动恢复", tb && tb.status === "done");

      await sleep(1500);
      const files = execSync(`ls "${outDir}"/ZeroZen/*/ 2>/dev/null || ls -R "${outDir}"`).toString();
      console.log("  saved files:", files.replace(/\n/g, " | "));
      let probe = "";
      try {
        // CDP 接管的下载目录以 GUID 命名文件：取最大的 mp4（qa-prot 时长最长）
        const f = execSync(`ls -S "${outDir}"/*.mp4 "${outDir}"/*/*/*.mp4 2>/dev/null | head -1`, { shell: "/bin/bash" }).toString().trim();
        probe = f ? execSync(`ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "${f}"`).toString().trim() : "";
      } catch (e) {}
      console.log("  qa-prot frames:", probe);
      check("TS 转封装为可播放 MP4（帧数完整）", Number(probe) >= 280);
      bc.close();
    }

    // —— 弹层判定：正常弹窗不误杀、广告弹层要拦；新窗口按交互判定 ——
    {
      const m = await newTab(`http://localhost:${HTTP_PORT}/pages/modals.html`);
      await sleep(2000);
      const p = await new Conn(m.webSocketDebuggerUrl).connect();
      const clickEl = async (sel) => {
        const pt = await p.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        for (const type of ["mousePressed", "mouseReleased"]) {
          await p.send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 });
        }
        await sleep(300);
      };
      await sleep(1500);
      await clickEl("#bOauth");
      await clickEl("#bCross");
      await clickEl("#bAsync");
      await clickEl("#plain");
      await clickEl("#bMenu");
      await sleep(5500);
      const r = await p.evaluate(`(() => {
        const vis = (id) => { const el = document.getElementById(id); if (!el) return false; const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.5; };
        return {
          legit: ["L1","L2","L3","L4","L5","L6"].map((id) => [id, vis(id)]),
          ads: ["A1","A2","A3","A4"].map((id) => [id, vis(id)]),
          opens: window.__opens,
        };
      })()`);
      console.log("  modals:", JSON.stringify(r));
      const legitOk = r.legit.filter(([, v]) => v).length;
      const adsHidden = r.ads.filter(([, v]) => !v).length;
      check(`正常弹窗保留 ${legitOk}/6`, legitOk === 6);
      check(`广告弹层拦截 ${adsHidden}/4`, adsHidden === 4);
      const o = r.opens || {};
      check("OAuth/站外按钮/异步同源 新窗口放行", o.oauth === true && o.cross === true && o.async === true);
      check("popunder/无手势 新窗口拦截", o.popunder === false && o.auto === false);
      p.close();
      await closeTab(m.id);
    }

    // —— 黄金样本：正常 UI（登录/订阅/搜索/播放器/购物车/评论区）绝不被隐藏 ——
    {
      const g = await newTab(`http://localhost:${HTTP_PORT}/pages/golden.html`);
      await sleep(7000);
      const p = await new Conn(g.webSocketDebuggerUrl).connect();
      const r = await p.evaluate(`({
        login: document.getElementById("gLogin").offsetWidth > 0,
        email: document.getElementById("gEmail").offsetWidth > 0,
        search: document.getElementById("gSearch").offsetWidth > 0,
        overlay: document.getElementById("gOverlay").offsetWidth > 0,
        player: document.getElementById("gPlayer").offsetWidth > 0,
        cart: document.getElementById("gCart").offsetWidth > 0,
        comments: document.getElementById("gComments").offsetWidth > 0,
        popupLogin: document.getElementById("gPopupLogin").offsetWidth > 0,
      })`);
      const visible = Object.entries(r).filter(([, v]) => v).length;
      check(`黄金样本可见 ${visible}/8`, visible === 8);
      p.close();
      await closeTab(g.id);
    }

    c.close();
  } finally {
    proc.kill("SIGKILL").catch?.(() => {});
    try {
      execSync(`pkill -f "user-data-dir=${profile}" 2>/dev/null || true`);
    } catch (e) {}
    server.close();
    await sleep(500);
    try {
      rmSync(work, { recursive: true, force: true });
    } catch (e) {}
  }

  console.log(`\ne2e PASS ${ok.length}/${ok.length + bad.length}: ${ok.join(" | ")}`);
  if (bad.length) {
    console.log("e2e FAIL: " + bad.join(" | "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("e2e error:", e.message);
  process.exit(1);
});

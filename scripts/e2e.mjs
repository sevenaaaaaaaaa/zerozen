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
    hasHls = existsSync(join(enc, "enc.m3u8"));
  } catch (e) {
    console.log("  (ffmpeg 不可用，跳过 m3u8 下载项)");
  }
  return { hasHls };
}

function serveStatic(root) {
  const server = createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
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
  const server = await serveStatic(work);

  const proc = spawn(browser, [
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT_PATH}`,
    `--remote-debugging-port=${PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
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
          func: () => [...document.querySelectorAll("[data-zz-ui]")].some((el) => el.shadowRoot),
        });
        if (!probe[0].result) await chrome.tabs.sendMessage(tabs[0].id, { type: "zz:reader:toggle" });
        await new Promise((r2) => setTimeout(r2, 1500));
        const probe2 = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            const host = [...document.querySelectorAll("[data-zz-ui]")].find((el) => el.shadowRoot);
            if (!host) return null;
            const sr = host.shadowRoot;
            return { junk: sr.querySelectorAll(".body style,.body [style]").length, paras: sr.querySelectorAll(".body p").length };
          },
        });
        return probe2[0].result;
      })()`);
      check("阅读模式挂载（后台 tab）", !!entered);
      check("正文样式净化", !!entered && entered.junk === 0 && entered.paras === 3);

      // —— Markdown 保存（CDP 接管下载目录）——
      const bws = await fetch(`http://localhost:${PORT}/json/version`).then((r) => r.json());
      const bc = await new Conn(bws.webSocketDebuggerUrl).connect();
      await bc.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: outDir });
      await p.evaluate(`(() => {
        const host = [...document.querySelectorAll("[data-zz-ui]")].find((el) => el.shadowRoot);
        [...host.shadowRoot.querySelectorAll("button")].find((b) => /Markdown/.test(b.textContent)).click();
      })()`);
      await sleep(3000);
      const saved = execSync(`ls "${outDir}" 2>/dev/null || true`).toString().trim();
      check("Markdown 保存落盘", saved.length > 0);
      bc.close();
      p.close();
      await closeTab(art.id);
    }

    // —— m3u8 AES-128 下载（engine 全链路到合并，保存因权限由真实用户手势授权）——
    if (hasHls) {
      const tb = await newTab(`chrome-extension://invalid/ui/toolbox.html`).catch(() => null);
      await closeTab(tb.id).catch(() => {});
      const extId = await c.evaluate(`new URL(chrome.runtime.getURL("manifest.json")).host`);
      const tbt = await newTab(`chrome-extension://${extId}/ui/toolbox.html`);
      await sleep(2500);
      const p = await new Conn(tbt.webSocketDebuggerUrl).connect();
      const r = await p.evaluate(`(async () => {
        const log = [];
        try {
          await ZZDLEngine.downloadM3u8("http://localhost:${HTTP_PORT}/enc.m3u8", {
            concurrency: 4, onProgress: (t) => log.push(t), isCancelled: () => false, nameBase: "qa-e2e", dir: "ZeroZen/视频",
          });
          return { saved: true };
        } catch (e) {
          return { permFail: /downloads|下载/.test(String(e.message)), err: String(e.message) };
        }
      })()`);
      check("m3u8 AES-128 分片/解密/合并", r.saved || r.permFail);
      const idb = await p.evaluate(`(async () => {
        const tasks = await ZZDLStore.listTasks();
        const t = tasks.find((x) => x.nameBase === "qa-e2e");
        if (!t) return { cleaned: true };
        const sizes = await ZZDLStore.chunkSizes(t.id);
        return { done: t.done, total: t.total, chunks: Object.keys(sizes.sizes).length };
      })()`);
      check("分片缓存完整（断点续传）", idb.cleaned || (idb.done === idb.total && idb.chunks >= 3));
      p.close();
      await closeTab(tbt.id);
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

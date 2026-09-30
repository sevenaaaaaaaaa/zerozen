// 净化足迹浮球：页面内误拦快速撤销。
// 拦截发生时 10-css 会调 ZZ.Undo.record 记录元素；浮球列出最近记录，
// 点「恢复」= 选择器写入站点级豁免（持久，刷新不复发）+ 本地立即恢复 sweep/text 隐藏。
(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u || !u.isTop || !u.isTop()) return;

  const MAX_RECORDS = 12;
  const records = [];
  const seen = new WeakSet();
  let host = null;
  let root = null;
  let listEl = null;
  let ballEl = null;
  let panelOpen = false;
  let enabled = true;

  function summary(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? "#" + el.id : "";
    let cls = typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    if (cls === ".") cls = "";
    const text = (el.textContent || "").trim().slice(0, 26);
    return tag + id + cls + (text ? " 「" + text + "」" : "");
  }

  function record(el, meta) {
    if (!enabled || !el || !el.isConnected) return;
    if (seen.has(el)) return;
    seen.add(el);
    records.unshift({ el, how: (meta && meta.kind) || "css", sel: (meta && meta.sel) || "", text: summary(el), at: Date.now() });
    if (records.length > MAX_RECORDS) {
      const dropped = records.splice(MAX_RECORDS);
      for (const d of dropped) seen.delete(d.el);
    }
    render();
  }

  function localRestore(item) {
    // sweep/text 是本页内联样式隐藏，直接解除；css 类由豁免重注入生效
    try {
      if (item.how !== "css") {
        item.el.style.removeProperty("display");
        item.el.removeAttribute("data-zz-overlay");
      }
    } catch (e) {}
  }

  async function restore(item) {
    const alive = item.el && item.el.isConnected;
    if (item.sel && alive) {
      // CSS 规则隐藏：写站点级豁免（持久），SW 会重注入并广播 rules-updated
      await ZZ.send({ type: "zz:site:undo", payload: { host: u.host(), add: [item.sel] } });
    }
    localRestore(item);
    drop(item);
  }

  function drop(item) {
    const i = records.indexOf(item);
    if (i >= 0) records.splice(i, 1);
    if (item.el) seen.delete(item.el);
    render();
  }

  function buildUi() {
    host = document.createElement("div");
    host.setAttribute("data-zz-ui", "1");
    host.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483599;";
    const style = document.createElement("style");
    style.textContent =
      ":host{all:initial}*{box-sizing:border-box;font:13px/1.4 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif}" +
      ".ball{display:flex;align-items:center;gap:5px;padding:7px 12px;border-radius:999px;cursor:pointer;" +
      "background:rgba(24,30,44,.78);color:#e8eefb;border:1px solid rgba(255,255,255,.16);" +
      "box-shadow:0 6px 24px rgba(0,0,0,.3);backdrop-filter:blur(14px);opacity:.72;transition:opacity .2s}" +
      ".ball:hover{opacity:1}" +
      ".ball .n{font-weight:700}" +
      ".panel{position:absolute;right:0;bottom:44px;width:330px;max-height:60vh;overflow:auto;border-radius:14px;" +
      "background:rgba(24,30,44,.95);color:#e8eefb;border:1px solid rgba(255,255,255,.14);" +
      "box-shadow:0 14px 44px rgba(0,0,0,.4);backdrop-filter:blur(18px);padding:12px}" +
      ".hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-weight:700}" +
      ".hd .clr{font-size:12px;cursor:pointer;opacity:.75}.hd .clr:hover{opacity:1}" +
      ".it{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:9px}" +
      ".it:hover{background:rgba(255,255,255,.07)}" +
      ".it .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9}" +
      ".it .r{flex:none;font-size:12px;padding:3px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.25);" +
      "background:transparent;color:#e8eefb;cursor:pointer}" +
      ".it .r:hover{background:rgba(255,255,255,.12)}" +
      ".empty{opacity:.65;padding:10px 4px}" +
      ".tip{opacity:.6;font-size:11px;margin-top:8px}";
    root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    root.appendChild(style);
    ballEl = document.createElement("div");
    ballEl.className = "ball";
    ballEl.innerHTML = '<span>🛡</span><span class="n">0</span>';
    ballEl.addEventListener("click", () => {
      panelOpen = !panelOpen;
      render();
    });
    root.appendChild(ballEl);
    listEl = document.createElement("div");
    listEl.className = "panel";
    listEl.hidden = true;
    root.appendChild(listEl);
    (document.body || document.documentElement).appendChild(host);
  }

  function render() {
    if (!host || !host.isConnected) buildUi();
    host.style.display = enabled && records.length ? "" : "none";
    ballEl.querySelector(".n").textContent = String(records.length);
    listEl.hidden = !panelOpen || !records.length;
    if (listEl.hidden) return;
    const restoreLabel = ZZ.T("恢复");
    const items = records
      .map(
        (it, i) =>
          '<div class="it"><span class="t" title="' +
          it.text.replace(/"/g, "&quot;") +
          '">' +
          it.text +
          "</span><button class='r' data-i='" +
          i +
          "'>" +
          restoreLabel +
          "</button></div>"
      )
      .join("");
    listEl.innerHTML =
      '<div class="hd"><span>' + ZZ.T("净化足迹") + " · " + records.length + '</span><span class="clr">' + ZZ.T("全部恢复") + "</span></div>" +
      items +
      '<div class="tip">' + ZZ.T("被误拦的元素点「恢复」即可找回；恢复对本站长期生效。") + "</div>";
    listEl.querySelectorAll(".it .r").forEach((btn) => {
      btn.addEventListener("click", () => restore(records[Number(btn.getAttribute("data-i"))]));
    });
    listEl.querySelector(".clr").addEventListener("click", async () => {
      const sels = Array.from(new Set(records.map((r) => r.sel).filter(Boolean)));
      for (const it of records.slice()) localRestore(it);
      records.length = 0;
      if (sels.length) await ZZ.send({ type: "zz:site:undo", payload: { host: u.host(), add: sels } });
      render();
    });
  }

  let settingsLoaded = false;
  async function loadConfig() {
    try {
      const res = await ZZ.send({ type: "zz:settings:get" });
      const tb = res && res.ok && res.settings && res.settings.toolbox;
      enabled = !tb || tb.undoWidget !== false;
    } catch (e) {}
    settingsLoaded = true;
    render();
  }

  ZZ.Undo = { record };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      loadConfig();
      setTimeout(render, 2500);
    });
  } else {
    loadConfig();
    setTimeout(render, 2500);
  }
})();

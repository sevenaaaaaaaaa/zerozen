(function () {
  const UI = globalThis.ZZUI;
  const $ = UI.$;
  const T = UI.T;
  const api = globalThis.ZZ.browser;

  let tab = null;
  let host = "";
  let refreshTimer = null;

  function renderState(state) {
    const c = state.counts || {};
    $("#statHidden").textContent = (c.cosmetic || 0) + (c.texts || 0) + (c.removed || 0);
    $("#statNetwork").textContent = c.network || 0;
    $("#statPopups").textContent = c.popups || 0;
    $("#globalEnabled").checked = !!state.enabled;
    $("#siteEnabled").checked = !!state.siteEnabled;
    lastState = state;
    const profile = state.profile || state.globalProfile || "standard";
    for (const btn of document.querySelectorAll("#profileSeg .zz-seg-btn")) {
      btn.classList.toggle("active", btn.getAttribute("data-profile") === profile);
      btn.disabled = !state.enabled;
    }
    const sourceLabel =
      state.profileSource === "site"
        ? T("本站设置")
        : state.profileSource === "auto"
        ? T("自动回落")
        : state.profileSource === "global"
        ? T("跟随全局")
        : state.profileSource === "temporary"
        ? T("临时放行")
        : T("已关闭");
    $("#profileHint").textContent = sourceLabel;
    const auto = state.autoCompat;
    $("#autoCompatHint").hidden = !auto;
    if (auto) {
      $("#autoCompatText").textContent =
        T("检测到反广告拦截，已回落为兼容档") + (state.until ? T("（临时放行至 $1）", fmtTime(state.until)) : "");
    }
    const until = state.until || 0;
    const tempBtn = $("#btnTemp");
    if (until > Date.now()) {
      const mins = Math.max(1, Math.round((until - Date.now()) / 60000));
      tempBtn.textContent = T("已临时放行 · 剩余 $1 分钟 · 点击恢复", mins);
      tempBtn.classList.add("zz-btn-danger");
    } else {
      tempBtn.textContent = T("临时解除 $1 分钟", state.tempMinutes || 30);
      tempBtn.classList.remove("zz-btn-danger");
    }
    const types = state.types || {};
    for (const input of document.querySelectorAll(".zz-chip input[data-type]")) {
      input.checked = !!types[input.getAttribute("data-type")];
    }
    $("#siteHint").textContent = state.siteEnabled
      ? T("本站已启用") + (state.index && state.index.invalid ? T("（$1 条规则无效已跳过）", state.index.invalid) : "")
      : T("本站已停用，不会隐藏或拦截任何内容");
    const dnr = state.dnr || {};
    $("#engineInfo").textContent =
      T("网络规则 $1 条 · 外观规则 $2 条", dnr.applied || 0, (state.index && state.index.cosmetic) || 0);
    $("#pendingCount").textContent = state.findingsPending || 0;
    $("#btnAi").title = state.aiConfigured ? "" : T("请先在控制台配置 AI 接口");
  }

  let lastState = null;

  function fmtTime(ts) {
    try {
      const d = new Date(ts);
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    } catch (e) {
      return "";
    }
  }

  async function loadFindings() {
    const res = await UI.send({ type: "zz:findings:list", payload: { host, status: "pending" } });
    const list = (res && res.findings) || [];
    const section = $("#findingsSection");
    const box = $("#findings");
    if (!list.length) {
      section.hidden = true;
      box.innerHTML = "";
      return;
    }
    section.hidden = false;
    box.innerHTML = "";
    for (const f of list.slice(0, 12)) {
      const card = document.createElement("div");
      card.className = "zz-card";
      const conf = Math.round((f.confidence || 0) * 100);
      card.innerHTML = `
        <div class="zz-row">
          <span class="zz-tag zz-tag-${f.source === "ai" ? "ai" : "scan"}">${escapeHtml(UI.categoryLabel(f.category))} · ${conf}%</span>
          <button class="zz-btn zz-btn-sm zz-btn-ghost" data-id="${escapeHtml(f.id)}">${escapeHtml(T("屏蔽"))}</button>
        </div>
        <div class="zz-code">${escapeHtml(f.selector)}</div>
        ${f.reason ? `<div class="zz-small zz-muted" style="margin-top:4px">${escapeHtml(f.reason)}</div>` : ""}
      `;
      box.appendChild(card);
    }
    box.onclick = async (event) => {
      const btn = event.target.closest("button[data-id]");
      if (!btn) return;
      btn.disabled = true;
      const res2 = await UI.send({
        type: "zz:findings:apply",
        payload: { ids: [btn.getAttribute("data-id")], scope: "site" },
      });
      if (res2 && res2.ok) {
        UI.toast($("#msg"), T("已添加规则"), "ok");
        await refresh();
      }
    };
  }

  function escapeHtml(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  async function refresh() {
    if (!tab) return;
    const res = await UI.send({ type: "zz:state:get", payload: { tabId: tab.id } });
    if (res && res.ok) {
      if (res.host && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(res.host)) host = res.host;
      $("#host").textContent = host || tab.title || T("当前页面");
      renderState(res);
    }
    const sniff = await UI.send({ type: "zz:sniff:list", payload: { tabId: tab.id } });
    const count = sniff && sniff.streams ? sniff.streams.length : 0;
    const badge = $("#sniffCount");
    if (badge) badge.textContent = count ? "(" + count + ")" : "";
    const hint = $("#toolHint");
    if (hint) {
      hint.textContent = count
        ? T("已嗅探到 $1 条视频流。点「下载本页视频」，勾选后下载到 ZeroZen/视频。", count)
        : T("先在网页里点播放，再点「下载本页视频」。工具箱会列出嗅探到的 m3u8，勾选后下载。");
    }
  }

  async function init() {
    await UI.initLocale();
    tab = await UI.currentTab();
    if (!tab) return;
    try {
      host = new URL(tab.url).hostname.toLowerCase();
    } catch (e) {
      host = "";
    }
    if (!/^https?:/i.test(tab.url || "")) {
      $("#host").textContent = T("此页面不支持");
      $("#siteHint").textContent = T("ZeroZen 仅作用于 http/https 页面");
      $("#btnAi").disabled = true;
      $("#btnPick").disabled = true;
      $("#siteEnabled").disabled = true;
      return;
    }
    $("#host").textContent = host || tab.title || T("当前页面");
    await refresh();
    await loadFindings();
    refreshTimer = setInterval(refresh, 2000);
  }

  $("#globalEnabled").addEventListener("change", async (event) => {
    const res = await UI.send({ type: "zz:settings:set", payload: { settings: { enabled: event.target.checked } } });
    if (!res || !res.ok) {
      UI.toast($("#msg"), T("操作失败：$1", (res && res.error) || T("后台无响应")), "err");
      setTimeout(refresh, 200);
      return;
    }
    UI.toast($("#msg"), T(event.target.checked ? "ZeroZen 已启用" : "ZeroZen 已全局停用"), event.target.checked ? "ok" : "");
    setTimeout(refresh, 300);
  });

  $("#siteEnabled").addEventListener("change", async (event) => {
    const enabled = event.target.checked;
    const res = await UI.send({ type: "zz:site:set", payload: { host, enabled, tabId: tab && tab.id } });
    if (!res || !res.ok) {
      UI.toast($("#msg"), T("操作失败：$1", (res && res.error) || T("后台无响应")), "err");
      setTimeout(refresh, 200);
      return;
    }
    UI.toast($("#msg"), T(enabled ? "已在此站点启用" : "已在此站点停用"), enabled ? "ok" : "");
    setTimeout(refresh, 300);
  });

  $("#profileSeg").addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-profile]");
    if (!btn || btn.disabled) return;
    for (const b of document.querySelectorAll("#profileSeg .zz-seg-btn")) {
      b.classList.toggle("active", b === btn);
    }
    const res = await UI.send({
      type: "zz:site:set",
      payload: { host, profile: btn.getAttribute("data-profile"), clearAuto: true, tabId: tab && tab.id },
    });
    if (!res || !res.ok) {
      UI.toast($("#msg"), T("切换失败：$1", (res && res.error) || T("后台无响应")), "err");
      setTimeout(refresh, 200);
      return;
    }
    UI.toast($("#msg"), T("已切换为「$1」档", btn.textContent.trim()), "ok");
    setTimeout(refresh, 300);
  });

  $("#btnTemp").addEventListener("click", async () => {
    const until = (lastState && lastState.until) || 0;
    if (until > Date.now()) {
      await UI.send({ type: "zz:site:temp", payload: { host, minutes: 0, tabId: tab && tab.id } });
      UI.toast($("#msg"), T("已恢复拦截"), "ok");
    } else {
      const minutes = (lastState && lastState.tempMinutes) || 30;
      await UI.send({ type: "zz:site:temp", payload: { host, minutes, tabId: tab && tab.id } });
      UI.toast($("#msg"), T("已临时放行本站 $1 分钟", minutes), "ok");
    }
    setTimeout(refresh, 300);
  });

  $("#btnResetAuto").addEventListener("click", async () => {
    await UI.send({ type: "zz:site:set", payload: { host, profile: "default", clearAuto: true, tabId: tab && tab.id } });
    UI.toast($("#msg"), T("已恢复本站默认设置"), "ok");
    setTimeout(refresh, 300);
  });

  $("#btnClean").addEventListener("click", async () => {
    const res = await UI.send({ type: "zz:clean:set", payload: { tabId: tab && tab.id } });
    if (res && res.ok) UI.toast($("#msg"), T(res.active ? "已进入纯净浏览（再点一次恢复）" : "已退出纯净浏览"), "ok");
    else UI.toast($("#msg"), T("操作失败：$1", (res && res.error) || T("内容脚本无响应")), "err");
  });

  $("#btnReader").addEventListener("click", async () => {
    const res = await UI.send({ type: "zz:reader:toggle", payload: { tabId: tab && tab.id } });
    if (res && res.ok) UI.toast($("#msg"), T(res.active ? "已进入阅读模式（可保存 Markdown）" : "已退出阅读模式"), "ok");
    else UI.toast($("#msg"), T("阅读模式失败：$1", (res && res.error) || T("无法提取正文")), "err");
  });

  $("#btnToolbox").addEventListener("click", async () => {
    UI.toast($("#msg"), T("正在打开下载工具箱…"), "ok");
    const ok = await UI.openToolbox(tab && tab.id);
    if (!ok) {
      UI.toast($("#msg"), T("打不开工具箱，请重载扩展后再试"), "err");
      return;
    }
    window.close();
  });

  document.querySelector(".zz-chips").addEventListener("change", async (event) => {
    const input = event.target.closest("input[data-type]");
    if (!input) return;
    const type = input.getAttribute("data-type");
    if (type === "annoyances") {
      await UI.send({ type: "zz:packs:set", payload: { id: "annoyances", enabled: input.checked } });
    } else {
      const key = type === "popup" ? "popupGuard" : type;
      const settings = {};
      settings[key] = input.checked;
      await UI.send({ type: "zz:settings:set", payload: { settings } });
    }
    UI.toast($("#msg"), T("已更新屏蔽类型"), "ok");
    setTimeout(refresh, 300);
  });

  $("#btnAi").addEventListener("click", async (event) => {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = T("正在识别…（会调用一次 AI）");
    const res = await UI.send({ type: "zz:ai:recognize-tab", payload: { tabId: tab && tab.id } });
    btn.disabled = false;
    btn.textContent = T("AI 识别本页烦人广告");
    if (!res || !res.ok) {
      UI.toast($("#msg"), T("识别失败：$1", (res && res.error) || T("未知错误")), "err");
      return;
    }
    const found = (res.findings || []).length;
    UI.toast(
      $("#msg"),
      found
        ? T("识别到 $1 处，已在页面标记", found) + (res.applied ? T("，自动屏蔽 $1 处", res.applied) : "")
        : T("未发现新的广告元素"),
      "ok"
    );
    await refresh();
    await loadFindings();
  });

  $("#btnPick").addEventListener("click", async () => {
    await UI.send({ type: "zz:picker:start", payload: { tabId: tab && tab.id } });
    window.close();
  });

  $("#btnOptions").addEventListener("click", async () => {
    const ok = await UI.openOptions();
    if (!ok) {
      UI.toast($("#msg"), T("打不开控制台，请重载扩展后再试"), "err");
      return;
    }
    window.close();
  });

  $("#btnApplyAll").addEventListener("click", async () => {
    const res = await UI.send({ type: "zz:findings:list", payload: { host, status: "pending" } });
    const ids = ((res && res.findings) || []).map((f) => f.id);
    if (!ids.length) return;
    const applied = await UI.send({ type: "zz:findings:apply", payload: { ids, scope: "site" } });
    UI.toast(
      $("#msg"),
      applied && applied.ok ? T("已屏蔽 $1 条", applied.rules) : T("操作失败"),
      applied && applied.ok ? "ok" : "err"
    );
    await refresh();
    await loadFindings();
  });

  $("#linkReview").addEventListener("click", (event) => {
    event.preventDefault();
    api.tabs.create({ url: api.runtime.getURL("ui/options.html#findings") });
  });

  window.addEventListener("unload", () => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  init();
})();

(function () {
  const UI = globalThis.ZZUI;
  const $ = UI.$;
  const T = UI.T;
  const api = globalThis.ZZ.browser;

  let tab = null;
  let host = "";
  let refreshTimer = null;
  let lastState = null;
  let media = null;
  let tasks = null;

  function bumpStat(id, value) {
    const el = $(id);
    const next = String(value == null ? 0 : value);
    if (!el || el.textContent === next) return;
    el.textContent = next;
    el.classList.remove("zz-bump");
    void el.offsetWidth; // 重启动画
    el.classList.add("zz-bump");
  }

  const REASON = {
    "ad-host": "广告联盟",
    popunder: "点空白处弹出",
    "double-open": "一次点击多开",
    "no-gesture": "自动弹出",
    clickjack: "透明劫持层",
  };

  function needReload() {
    $("#reloadHint").hidden = false;
  }

  function renderState(state) {
    const c = state.counts || {};
    bumpStat("#statHidden", (c.cosmetic || 0) + (c.texts || 0) + (c.removed || 0));
    bumpStat("#statNetwork", c.network || 0);
    bumpStat("#statPopups", c.popups || 0);
    $("#globalEnabled").checked = !!state.enabled;
    $("#siteEnabled").checked = !!state.siteEnabled;
    lastState = state;
    const profile = state.profile || state.globalProfile || "standard";
    for (const btn of document.querySelectorAll("#profileSeg .zz-seg-btn")) {
      btn.classList.toggle("active", btn.getAttribute("data-profile") === profile);
      btn.disabled = !state.enabled || !state.siteEnabled;
    }
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
      tempBtn.textContent = T("放行中 · 剩 $1 分钟 · 恢复", mins);
      tempBtn.classList.add("danger");
    } else {
      tempBtn.textContent = T("临时放行 $1 分钟", state.tempMinutes || 30);
      tempBtn.classList.remove("danger");
    }
    $("#btnTempPromote").hidden = !(until > Date.now());
    const types = state.types || {};
    for (const input of document.querySelectorAll(".zz-chip input[data-type]")) {
      input.checked = !!types[input.getAttribute("data-type")];
    }
    const wl = $("#btnWhitelist");
    wl.textContent = state.siteEnabled ? T("加入白名单") : T("移出白名单");
    wl.classList.toggle("danger", !state.siteEnabled);
    $("#siteHint").textContent = state.siteEnabled
      ? until > Date.now()
        ? T("临时放行中")
        : T("保护中") + " · " + T(profileName(profile))
      : state.whitelistSource
      ? T("已随 $1 加入白名单", state.whitelistSource)
      : T("本站已停用，不会隐藏或拦截任何内容");
    $("#popupsAllowedHint").hidden = !state.popupsAllowed;
    const dnr = state.dnr || {};
    $("#engineInfo").textContent = T("网络规则 $1 条 · 外观规则 $2 条", dnr.applied || 0, (state.index && state.index.cosmetic) || 0);
    renderDetail(state);
    $("#pendingCount").textContent = state.findingsPending || 0;
    $("#btnAi").title = state.aiConfigured ? T("让 AI 找出本页的广告") : T("请先在控制台配置 AI 接口");
  }

  function profileName(p) {
    return p === "compat" ? "兼容" : p === "strict" ? "严格" : "标准";
  }

  // 本页拦截明细：命中的规则包 + 被拦的新窗口（含原因），点三个数字展开
  function renderDetail(state) {
    const hitList = (state.counts && state.counts.packs) || [];
    const pops = state.popupLog || [];
    const nameOf = (key) => {
      if (key === "@user") return T("自定义规则");
      if (key === "@other") return T("其他来源");
      const pack = (state.packs || []).find((p) => p.id === key);
      return pack ? pack.name : key;
    };
    let html = "";
    if (hitList.length) {
      html += "<h4>" + escapeHtml(T("命中规则")) + "</h4>";
      html += hitList.map((h) => "<div class='row'><span>" + escapeHtml(nameOf(h.key)) + "</span><span>" + h.n + "</span></div>").join("");
    }
    if (pops.length) {
      html += "<h4>" + escapeHtml(T("拦截的弹窗")) + "</h4>";
      html += pops
        .slice(0, 6)
        .map((p) => {
          let h = p.url;
          try {
            h = new URL(p.url).hostname;
          } catch (e) {}
          return "<div class='row'><span title='" + escapeHtml(p.url) + "'>" + escapeHtml(h || T("通知权限请求")) + "</span><span class='zz-muted'>" + escapeHtml(T(REASON[p.reason] || "可疑")) + "</span></div>";
        })
        .join("");
      if (!state.popupsAllowed) {
        html += "<div style='margin-top:6px'><a href='#' id='btnPopupsAllow'>" + escapeHtml(T("误拦了？允许本站弹出新窗口")) + "</a></div>";
      }
    }
    if (!html) html = "<div class='zz-muted'>" + escapeHtml(T("本页还没有拦截记录")) + "</div>";
    const box = $("#detail");
    if (box._sig !== html) {
      box._sig = html;
      box.innerHTML = html;
    }
  }

  function fmtTime(ts) {
    try {
      const d = new Date(ts);
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    } catch (e) {
      return "";
    }
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
        playSparkle(btn);
        fxClean(1);
        await refresh();
      }
    };
  }

  // 下载按钮魔法特效：迸发六颗光点
  function playSparkle(btn) {
    if (!btn || !btn.getBoundingClientRect) return;
    const r = btn.getBoundingClientRect();
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
    document.body.appendChild(holder);
    for (let i = 0; i < 6; i++) {
      const spark = document.createElement("span");
      const ang = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      const dist = 26 + Math.random() * 18;
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist - 8;
      spark.style.cssText =
        "position:absolute;left:" + (r.left + r.width / 2) + "px;top:" + (r.top + r.height / 2) + "px;" +
        "width:6px;height:6px;border-radius:50%;background:radial-gradient(circle,#93c5fd,#3b82f6);" +
        "box-shadow:0 0 8px rgba(59,130,246,.9);" +
        "transition:transform .55s cubic-bezier(.22,1.4,.36,1),opacity .55s ease;";
      holder.appendChild(spark);
      requestAnimationFrame(() => {
        spark.style.transform = "translate(" + dx + "px," + dy + "px) scale(0.2)";
        spark.style.opacity = "0";
      });
    }
    setTimeout(() => holder.remove(), 700);
  }

  async function fxClean(count) {
    if (!tab) return;
    try {
      await api.tabs.sendMessage(tab.id, { type: "zz:fx:clean", payload: { count: count || 0 } });
    } catch (e) {}
  }

  // ---------- 下载：本页视频 + 进行中的任务 ----------
  let mediaCount = 0;
  let taskCount = 0;
  function syncDlSection() {
    $("#dlSection").hidden = !(mediaCount || taskCount);
    $("#mediaTitle").textContent = mediaCount ? T("本页视频（$1）", mediaCount) : T("下载任务");
    $("#mediaList").hidden = !mediaCount;
  }

  function initDownloads() {
    media = ZZDLUI.mediaList($("#mediaList"), {
      tabId: tab.id,
      compact: true,
      toastEl: $("#msg"),
      onCount: (n) => {
        mediaCount = n;
        syncDlSection();
      },
      onAdded: (task, btn) => {
        playSparkle(btn);
        tasks.refresh();
      },
    });
    tasks = ZZDLUI.taskList($("#taskList"), {
      compact: true,
      toastEl: $("#msg"),
      onChange: (all, shown) => {
        taskCount = (shown || []).length;
        syncDlSection();
      },
    });
    media.refresh();
  }

  $("#btnRescan").addEventListener("click", (e) => {
    e.preventDefault();
    media && media.refresh();
  });
  $("#btnCenter").addEventListener("click", async (e) => {
    e.preventDefault();
    await UI.send({ type: "zz:dl:open-center" });
    window.close();
  });
  $("#stats").addEventListener("click", () => {
    $("#detail").hidden = !$("#detail").hidden;
  });
  $("#detail").addEventListener("click", async (e) => {
    const a = e.target.closest("#btnPopupsAllow");
    if (!a) return;
    e.preventDefault();
    await UI.send({ type: "zz:site:popups", payload: { host, allow: true, tabId: tab && tab.id } });
    UI.toast($("#msg"), T("已允许本站弹出新窗口"), "ok");
    refresh();
  });
  $("#btnPopupsRevoke").addEventListener("click", async () => {
    await UI.send({ type: "zz:site:popups", payload: { host, allow: false, tabId: tab && tab.id } });
    UI.toast($("#msg"), T("已恢复本站的弹窗拦截"), "ok");
    refresh();
  });

  async function refresh() {
    if (!tab) return;
    const res = await UI.send({ type: "zz:state:get", payload: { tabId: tab.id } });
    if (res && res.ok) {
      if (res.host && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(res.host)) host = res.host;
      $("#host").textContent = host || tab.title || T("当前页面");
      renderState(res);
    }
  }

  async function init() {
    await UI.initLocale();
    // ?tab=<id>：调试/自动化测试时以指定标签页为上下文打开弹窗
    const forced = /[?&]tab=(\d+)/.exec(location.search);
    tab = forced ? await api.tabs.get(Number(forced[1])).catch(() => null) : await UI.currentTab();
    if (!tab) return;
    try {
      host = new URL(tab.url).hostname.toLowerCase();
    } catch (e) {
      host = "";
    }
    if (!/^https?:/i.test(tab.url || "")) {
      $("#host").textContent = T("此页面不支持");
      $("#siteHint").textContent = T("ZeroZen 仅作用于 http/https 页面");
      for (const id of ["#btnAi", "#btnPick", "#btnReader", "#btnClean", "#siteEnabled"]) $(id).disabled = true;
      $("#stats").hidden = true;
      $("#profileSeg").hidden = true;
      document.querySelector(".site-links").hidden = true;
      // 非网页也能看下载任务
      tasks = ZZDLUI.taskList($("#taskList"), {
        compact: true,
        toastEl: $("#msg"),
        onChange: (all, shown) => {
          taskCount = (shown || []).length;
          syncDlSection();
        },
      });
      return;
    }
    $("#host").textContent = host || tab.title || T("当前页面");
    initDownloads();
    await refresh();
    await loadFindings();
    refreshTimer = setInterval(() => refresh(), 2500);
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
    needReload();
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
    needReload();
    setTimeout(refresh, 300);
  });

  $("#btnTemp").addEventListener("click", async (event) => {
    event.preventDefault();
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

  $("#btnTempPromote").addEventListener("click", async (event) => {
    event.preventDefault();
    // enabled:false 落为白名单；until:0 清掉临时到期时间，clearAuto 顺带清掉自动回落标记
    const res = await UI.send({
      type: "zz:site:set",
      payload: { host, enabled: false, until: 0, clearAuto: true, tabId: tab && tab.id },
    });
    if (res && res.ok) {
      UI.toast($("#msg"), T("已转正为白名单，本站长期不再拦截"), "ok");
    } else {
      UI.toast($("#msg"), T("操作失败：$1", (res && res.error) || T("后台无响应")), "err");
    }
    setTimeout(refresh, 300);
  });

  $("#btnWhitelist").addEventListener("click", async (event) => {
    event.preventDefault();
    const enable = !(lastState && lastState.siteEnabled);
    const res = await UI.send({ type: "zz:site:set", payload: { host, enabled: enable, tabId: tab && tab.id } });
    if (res && res.ok) {
      playSparkle($("#btnWhitelist"));
      UI.toast($("#msg"), T(enable ? "已移出白名单，恢复正常拦截" : "已加入白名单，本站不再拦截"), "ok");
    } else {
      UI.toast($("#msg"), T("操作失败：$1", (res && res.error) || T("后台无响应")), "err");
    }
    setTimeout(refresh, 300);
  });

  $("#btnReload").addEventListener("click", async () => {
    if (!tab || typeof tab.id !== "number") return;
    try {
      await api.tabs.reload(tab.id);
      UI.toast($("#msg"), T("页面已刷新"), "ok");
      setTimeout(() => window.close(), 400);
    } catch (e) {
      UI.toast($("#msg"), T("操作失败：$1", (e && e.message) || e), "err");
    }
  });

  $("#btnResetAuto").addEventListener("click", async () => {
    await UI.send({ type: "zz:site:set", payload: { host, profile: "default", clearAuto: true, tabId: tab && tab.id } });
    UI.toast($("#msg"), T("已恢复本站默认设置"), "ok");
    setTimeout(refresh, 300);
  });

  $("#btnClean").addEventListener("click", async () => {
    const res = await UI.send({ type: "zz:clean:set", payload: { tabId: tab && tab.id } });
    if (res && res.ok) {
      UI.toast($("#msg"), T(res.active ? "已进入纯净浏览（再点一次恢复）" : "已退出纯净浏览"), "ok");
      if (res.active) fxClean(0);
    } else UI.toast($("#msg"), T("操作失败：$1", (res && res.error) || T("内容脚本无响应")), "err");
  });

  $("#btnReader").addEventListener("click", async () => {
    // 用户手势里预授权下载权限：保存 Markdown/HTML 才能进 ZeroZen/阅读 目录（未授权也有页面级兜底）
    UI.ensurePermission("downloads");
    const res = await UI.send({ type: "zz:reader:toggle", payload: { tabId: tab && tab.id } });
    if (res && res.ok) UI.toast($("#msg"), T(res.active ? "已进入阅读模式（可保存 Markdown / HTML，可翻译）" : "已退出阅读模式"), "ok");
    else UI.toast($("#msg"), T("阅读模式失败：$1", (res && res.error) || T("无法提取正文")), "err");
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
    needReload();
    setTimeout(refresh, 300);
  });

  $("#btnAi").addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    const label = btn.querySelector("span");
    btn.disabled = true;
    label.textContent = T("识别中…");
    const res = await UI.send({ type: "zz:ai:recognize-tab", payload: { tabId: tab && tab.id } });
    btn.disabled = false;
    label.textContent = T("AI 识别");
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
    if (res.applied) fxClean(res.applied);
    await refresh();
    await loadFindings();
  });

  $("#btnPick").addEventListener("click", async () => {
    await UI.send({ type: "zz:picker:start", payload: { tabId: tab && tab.id } });
    window.close();
  });

  $("#btnOptions").addEventListener("click", async (event) => {
    event.preventDefault();
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
    if (applied && applied.ok) fxClean(applied.rules);
    await refresh();
    await loadFindings();
  });

  $("#linkReview").addEventListener("click", (event) => {
    event.preventDefault();
    api.tabs.create({ url: api.runtime.getURL("ui/options.html#findings") });
  });

  window.addEventListener("unload", () => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (tasks) tasks.stop();
  });

  init();
})();

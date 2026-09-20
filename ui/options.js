(function () {
  const UI = globalThis.ZZUI;
  const $ = UI.$;
  const $$ = UI.$$;
  const api = globalThis.ZZ.browser;
  const F = globalThis.ZZ.RuleFormat;
  const Detector = globalThis.ZZ.Detector;

  const CATEGORY_ORDER = ["all", "user", "ai", "scan", "import"];

  const state = {
    tab: "rules",
    settings: null,
    presets: [],
    packs: [],
    groups: [],
    packCounts: {},
    rules: [],
    ruleQuery: "",
    ruleSource: "all",
    ruleLimit: 200,
    findings: [],
    findingStatus: "pending",
    findingHost: "",
    sites: [],
    scanLog: [],
    scanFindings: [],
    scanSelected: new Set(),
    scanIds: [],
    scanning: false,
    aiCalls: 0,
    aiBudget: 20,
    port: null,
  };

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  function toast(text, kind) {
    UI.toast($("#msg"), text, kind);
  }

  function switchTab(name) {
    state.tab = name;
    $$(".zz-tab").forEach((btn) => btn.classList.toggle("active", btn.getAttribute("data-tab") === name));
    $$(".zz-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "panel-" + name));
    if (name === "stats") renderDiag();
    if (name === "findings") renderFindings();
    if (name === "autopilot") {
      refreshAutopilot();
      loadLearn();
    }
  }

  let autopilotTimer = null;

  async function refreshAutopilot() {
    const res = await UI.send({ type: "zz:autopilot:status" });
    if (!res) return;
    const box = $("#autoLog");
    if (box) {
      box.innerHTML = (res.log || [])
        .map((l) => '<div class="' + (l.level || "") + '">' + esc(l.text) + "</div>")
        .join("");
      box.scrollTop = box.scrollHeight;
    }
    const st = $("#autoState");
    if (st) {
      if (res.running) st.textContent = "运行中：" + (res.phase || "") + " " + res.done + "/" + res.total;
      else if (res.error) st.textContent = "上次失败：" + res.error;
      else if (res.lastRunAt) st.textContent = "上次运行：" + new Date(res.lastRunAt).toLocaleString() + "，站点 " + res.sites.length + "，应用 " + res.applied;
      else st.textContent = res.localReady ? "未运行" : "需配置本地模型";
    }
    const runBtn = $("#btnAutoRun");
    const stopBtn = $("#btnAutoStop");
    if (runBtn) runBtn.disabled = !!res.running;
    if (stopBtn) stopBtn.disabled = !res.running;
    if (res.running && !autopilotTimer) {
      autopilotTimer = setInterval(refreshAutopilot, 1500);
    } else if (!res.running && autopilotTimer) {
      clearInterval(autopilotTimer);
      autopilotTimer = null;
      loadLearn();
    }
  }

  async function loadLearn() {
    const res = await UI.send({ type: "zz:learn:list" });
    const box = $("#learnList");
    if (!res || !box) return;
    const list = res.patterns || [];
    if (!list.length) {
      box.innerHTML = '<div class="zz-small zz-muted">还没有学习记录：使用元素选取器、AI 确认或扫描应用规则后，这里会出现可复用的模式。</div>';
      return;
    }
    box.innerHTML = list
      .map(
        (p) =>
          '<div class="zz-card">' +
          '<div class="zz-row"><span class="zz-code">' +
          esc(p.selector) +
          "</span>" +
          (p.applied
            ? '<span class="zz-tag zz-tag-ai">已升级</span>'
            : '<button class="zz-btn zz-btn-sm zz-btn-primary" data-learn-apply="' +
              esc(p.selector) +
              '">升级为通用规则</button>') +
          "</div>" +
          '<div class="zz-small zz-muted" style="margin-top:4px">出现 ' +
          p.count +
          " 次 · " +
          p.sites +
          " 个站点" +
          (p.hosts && p.hosts.length ? "：" + esc(p.hosts.join("、")) : "") +
          "</div></div>"
      )
      .join("");
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (e) {
      return "";
    }
  }

  async function loadConfig() {
    const res = await UI.send({ type: "zz:settings:get" });
    if (res && res.ok) {
      state.settings = res.settings;
      state.hasApiKey = !!res.hasApiKey;
      state.presets = res.presets || [];
      state.aiBudget = res.settings.ai.budgetPerScan || 20;
      fillSettings();
    }
    const packs = await UI.send({ type: "zz:packs:list" });
    if (packs && packs.ok) {
      state.packs = packs.packs || [];
      state.groups = packs.groups || [];
      renderPacks();
    }
  }

  function fillSettings() {
    const s = state.settings;
    if (!s) return;
    $("#globalEnabled").checked = !!s.enabled;
    $("#profileSelect").value = s.profile || "standard";
    $("#autoFallback").checked = s.autoFallback !== false;
    $("#tempMinutes").value = s.tempMinutes || 30;
    $("#aiEnabled").checked = !!s.ai.enabled;
    $("#aiAutoApply").checked = !!s.ai.autoApply;
    $("#aiSendText").checked = s.ai.sendText !== false;
    $("#aiBaseUrl").value = s.ai.baseUrl || "";
    $("#aiModel").value = s.ai.model || "";
    $("#aiApiKey").value = s.ai.apiKey || "";
    $("#aiApiKey").placeholder = state.hasApiKey ? "已保存（留空则不修改）" : "sk-...";
    $("#aiMaxCandidates").value = s.ai.maxCandidates || 30;
    $("#aiMinConfidence").value = s.ai.minConfidence || 0.75;
    $("#aiBudget").value = s.ai.budgetPerScan || 20;
    $("#aiTimeout").value = s.ai.timeoutMs || 30000;
    $("#aiReasonLang").value = s.ai.reasonLang || "zh";
    $("#aiCustomPrompt").value = s.ai.customPrompt || "";
    $("#scanDelay").value = s.scanning.delayMs || 800;
    $("#scanConcurrency").value = s.scanning.concurrency || 1;
    $("#scanMaxSites").value = s.scanning.maxSites || 300;
    $("#scanAi").checked = s.scanning.aiReview !== false;
    $("#scanSkip").checked = s.scanning.skipScanned !== false;
    const mode = s.scanning.mode || "fast";
    $$('input[name="scanMode"]').forEach((el) => {
      el.checked = el.value === mode;
    });
    const auto = s.autonomous || {};
    $("#autoEnabled").checked = !!auto.enabled;
    $("#autoApplyFindings").checked = auto.autoApply !== false;
    $("#autoWeekly").checked = auto.weekly !== false;
    $("#autoMinVisits").value = auto.minVisits || 3;
    $("#autoMaxSites").value = auto.maxSites || 15;
    $("#autoThreshold").value = auto.threshold || 0.75;
    const learn = s.learning || {};
    $("#learnAuto").checked = learn.autoApply !== false;
    $("#learnMinSites").value = learn.minSites || 2;
    const tb = s.toolbox || {};
    $("#videoDir").value = tb.videoDir || "ZeroZen/视频";
    $("#imageDir").value = tb.imageDir || "ZeroZen/图片";
    $("#articleDir").value = tb.articleDir || "ZeroZen/阅读";
    $("#dlConcurrency").value = tb.concurrency || 4;
    $("#honestUrl").value = (s.honest && s.honest.url) || "";
    renderPresets();
  }

  function renderPresets() {
    const box = $("#presets");
    box.innerHTML = "";
    for (const preset of state.presets) {
      if (preset.id === "custom") continue;
      const btn = document.createElement("button");
      btn.className = "zz-preset";
      btn.textContent = preset.label;
      btn.addEventListener("click", () => {
        $("#aiBaseUrl").value = preset.baseUrl;
        $("#aiModel").value = preset.model;
        $("#aiApiKey").placeholder = preset.keyHint || "sk-...";
      });
      box.appendChild(btn);
    }
  }

  async function saveSettings(patch, quiet) {
    const res = await UI.send({ type: "zz:settings:set", payload: { settings: patch } });
    if (res && res.ok) {
      state.settings = Object.assign({}, state.settings, res.settings);
      if (!quiet) toast("设置已保存", "ok");
      return true;
    }
    toast("保存失败：" + ((res && res.error) || "未知错误"), "err");
    return false;
  }

  async function saveAi() {
    const apiKey = $("#aiApiKey").value.trim();
    const patch = {
      ai: {
        enabled: $("#aiEnabled").checked,
        autoApply: $("#aiAutoApply").checked,
        sendText: $("#aiSendText").checked,
        baseUrl: $("#aiBaseUrl").value.trim(),
        model: $("#aiModel").value.trim(),
        maxCandidates: Number($("#aiMaxCandidates").value) || 30,
        minConfidence: Number($("#aiMinConfidence").value) || 0.75,
        budgetPerScan: Number($("#aiBudget").value) || 20,
        timeoutMs: Number($("#aiTimeout").value) || 30000,
        reasonLang: $("#aiReasonLang").value,
        customPrompt: $("#aiCustomPrompt").value.trim(),
      },
    };
    if (apiKey) patch.ai.apiKey = apiKey;
    const ok = await saveSettings(patch);
    if (ok) {
      $("#aiApiKey").value = "";
      $("#aiApiKey").placeholder = "已保存（留空则不修改）";
      if (state.settings && state.settings.ai) state.aiBudget = state.settings.ai.budgetPerScan || 20;
    }
  }

  async function renderRacksCounts() {
    for (const pack of state.packs) {
      if (state.packCounts[pack.id] !== undefined) continue;
      try {
        const res = await fetch(api.runtime.getURL("rules/pack-" + pack.id + ".json"));
        const data = await res.json();
        state.packCounts[pack.id] = (data.rules || []).length;
      } catch (e) {
        state.packCounts[pack.id] = 0;
      }
    }
    renderPacks();
  }

  function renderPacks() {
    const grid = $("#packGrid");
    if (!grid) return;
    const groups = state.groups && state.groups.length
      ? state.groups
      : [{ id: "common", name: "规则包", desc: "" }];
    const html = groups
      .map((group) => {
        const packs = state.packs.filter((p) => (p.group || "common") === group.id);
        if (!packs.length) return "";
        const cards = packs
          .map((pack) => {
            const count = state.packCounts[pack.id];
            return (
              '<div class="zz-card">' +
              '<div class="zz-row"><b>' +
              esc(pack.name) +
              '</b><label class="zz-switch"><input type="checkbox" data-pack="' +
              esc(pack.id) +
              '"' +
              (pack.enabled ? " checked" : "") +
              "><span></span></label></div>" +
              '<div class="zz-small zz-muted" style="margin-top:4px">' +
              esc(pack.desc) +
              "</div>" +
              (count !== undefined
                ? '<div class="zz-small zz-muted">' + count + " 条规则</div>"
                : '<div class="zz-small zz-muted">加载中…</div>') +
              "</div>"
            );
          })
          .join("");
        return (
          '<h3 style="margin-top:18px">' +
          esc(group.name) +
          (group.desc ? '<span class="zz-small zz-muted" style="font-weight:400"> · ' + esc(group.desc) + "</span>" : "") +
          '</h3><div class="zz-grid">' +
          cards +
          "</div>"
        );
      })
      .join("");
    grid.innerHTML = html;
    grid.onchange = async (event) => {
      const input = event.target.closest("input[data-pack]");
      if (!input) return;
      const res = await UI.send({
        type: "zz:packs:set",
        payload: { id: input.getAttribute("data-pack"), enabled: input.checked },
      });
      if (res && res.ok) toast("规则包已更新，页面将自动刷新规则", "ok");
      await loadConfig();
    };
  }

  async function loadRules() {
    const res = await UI.send({
      type: "zz:rules:list",
      payload: { query: state.ruleQuery, source: state.ruleSource === "all" ? "" : state.ruleSource },
    });
    state.rules = (res && res.rules) || [];
    state.ruleTotal = (res && res.total) || state.rules.length;
    renderRules();
  }

  function ruleSummary(rule) {
    if (rule.kind === "network") return rule.regexFilter || rule.filter;
    if (rule.kind === "text") return "文案包含：" + rule.text + (rule.tag ? "（" + rule.tag + "）" : "");
    return rule.selector;
  }

  function renderRules() {
    const table = $("#ruleTable");
    const rows = state.rules.slice(0, state.ruleLimit);
    const head =
      "<tr><th>类型</th><th>规则</th><th>作用域</th><th>来源</th><th>启用</th><th></th></tr>";
    if (!rows.length) {
      table.innerHTML = head + '<tr><td colspan="6" class="zz-muted">暂无自定义规则。点击「导入规则」或使用 AI 识别 / 批量扫描生成。</td></tr>';
      $("#ruleCount").textContent = "";
      return;
    }
    table.innerHTML =
      head +
      rows
        .map((rule) => {
          const scope = rule.domains && rule.domains.length ? rule.domains.join(", ") : "所有站点";
          const kind = UI.kindLabel(rule);
          return (
            "<tr>" +
            '<td><span class="zz-tag zz-tag-' +
            esc(rule.source) +
            '">' +
            esc(kind) +
            "</span></td>" +
            '<td><div class="zz-code" style="margin:0">' +
            esc(ruleSummary(rule)) +
            "</div>" +
            (rule.note ? '<div class="zz-small zz-muted">' + esc(rule.note) + "</div>" : "") +
            "</td>" +
            '<td class="zz-small">' +
            esc(scope) +
            "</td>" +
            '<td class="zz-small">' +
            esc(UI.sourceLabel(rule.source)) +
            "</td>" +
            '<td><input type="checkbox" data-toggle="' +
            esc(rule.id) +
            '"' +
            (rule.enabled === false ? "" : " checked") +
            "></td>" +
            '<td><button class="zz-btn zz-btn-sm zz-btn-ghost zz-btn-danger" data-del="' +
            esc(rule.id) +
            '">删除</button></td>' +
            "</tr>"
          );
        })
        .join("");
    $("#ruleCount").textContent =
      "共 " + state.rules.length + " 条自定义规则" + (state.ruleTotal > state.rules.length ? "（显示前 " + rows.length + " 条）" : "");
    $("#btnShowMore").style.display = state.rules.length > state.ruleLimit ? "" : "none";
  }

  async function loadFindings() {
    const res = await UI.send({
      type: "zz:findings:list",
      payload: { status: state.findingStatus, host: state.findingHost || undefined },
    });
    state.findings = (res && res.findings) || [];
    renderFindings();
    if (state.findingStatus !== "pending" || state.findingHost) {
      const pending = await UI.send({ type: "zz:findings:list", payload: { status: "pending" } });
      $("#findingsBadge").textContent = ((pending && pending.findings) || []).length;
    }
  }

  function findingCard(finding, selected) {
    const conf = Math.round((finding.confidence || 0) * 100);
    const id = finding.id || (finding.host + "|" + finding.selector);
    return (
      '<div class="zz-card zz-finding">' +
      '<input type="checkbox" data-finding="' +
      esc(id) +
      '"' +
      (selected ? " checked" : "") +
      ">" +
      "<div>" +
      '<div class="zz-row" style="justify-content:flex-start;gap:8px">' +
      '<span class="zz-tag zz-tag-' +
      (finding.source === "ai" ? "ai" : "scan") +
      '">' +
      esc(UI.categoryLabel(finding.category)) +
      "</span>" +
      '<span class="zz-small zz-muted">' +
      esc(finding.host) +
      " · 置信度 " +
      conf +
      "%" +
      (finding.status && finding.status !== "pending" ? " · " + esc(finding.status === "applied" ? "已应用" : "已忽略") : "") +
      "</span></div>" +
      '<div class="zz-code">' +
      esc(finding.selector) +
      "</div>" +
      (finding.sample ? '<div class="zz-small zz-muted">文本：' + esc(finding.sample) + "</div>" : "") +
      (finding.reason ? '<div class="zz-small zz-muted">理由：' + esc(finding.reason) + "</div>" : "") +
      "</div>" +
      '<button class="zz-btn zz-btn-sm zz-btn-ghost zz-btn-danger" data-finding-del="' +
      esc(id) +
      '">删除</button>' +
      "</div>"
    );
  }

  function renderFindings() {
    const list = $("#findingList");
    if (!list) return;
    if (!state.findings.length) {
      list.innerHTML = '<div class="zz-muted zz-small">暂无记录。可以先用「批量扫描」或页面上的 AI 识别。</div>';
    } else {
      list.innerHTML = state.findings.map((f) => findingCard(f, false)).join("");
    }
    $("#findingsBadge").textContent = state.findings.filter((f) => f.status === "pending").length;
  }

  function selectedFindingIds(root) {
    return $$("input[data-finding]:checked", root || document).map((el) => el.getAttribute("data-finding"));
  }

  function renderScanFindings() {
    const box = $("#scanFindings");
    if (!state.scanFindings.length) {
      box.innerHTML = '<div class="zz-small zz-muted">扫描结果会显示在这里，可勾选后一键应用为规则。</div>';
      $("#applyInfo").textContent = "";
      return;
    }
    box.innerHTML = state.scanFindings
      .map((f) => findingCard(f, state.scanSelected.has(f.id)))
      .join("");
    $("#applyInfo").textContent = "显示 " + state.scanFindings.length + " 条，已选 " + state.scanSelected.size + " 条";
  }

  function addScanFindings(list) {
    let added = 0;
    for (const f of list || []) {
      if (!f || !f.id) continue;
      if (state.scanFindings.some((x) => x.id === f.id)) continue;
      state.scanFindings.push(f);
      if (f.status === "pending") state.scanSelected.add(f.id);
      added++;
    }
    if (added) renderScanFindings();
    return added;
  }

  async function loadBookmarks(folderId) {
    const res = await UI.send({ type: "zz:bookmarks:preview", payload: { folderId: folderId || "" } });
    if (!res || !res.supported) {
      $("#bookmarkInfo").textContent = "此浏览器不支持收藏夹接口（Safari 常见），请使用下方自定义站点列表";
      return;
    }
    const select = $("#folderSelect");
    if (select.options.length <= 1) {
      const options = ['<option value="">全部书签（' + res.total + " 个站点）</option>"];
      for (const folder of res.folders) {
        if (!folder.count) continue;
        options.push(
          '<option value="' + esc(folder.id) + '">' + esc(folder.path) + "（" + folder.count + "）</option>"
        );
      }
      select.innerHTML = options.join("");
    }
    $("#bookmarkInfo").textContent = "共 " + res.total + " 个站点";
    state.bookmarks = res.sites || [];
    mergeSites(state.bookmarks);
  }

  function mergeSites(list) {
    const map = new Map(state.sites.map((s) => [s.host, s]));
    let added = 0;
    for (const site of list || []) {
      const host = site.host || hostOf(site.url);
      if (!host) continue;
      if (map.has(host)) continue;
      map.set(host, { host, url: site.url, title: site.title || "", checked: true });
      added++;
    }
    state.sites = Array.from(map.values());
    $("#siteInfo").textContent = "已加入 " + added + " 个站点，待扫描 " + state.sites.length + " 个";
    renderSites();
  }

  function renderSites() {
    const grid = $("#siteGrid");
    grid.innerHTML = state.sites
      .map(
        (site, index) =>
          '<label class="zz-check"><input type="checkbox" data-site="' +
          index +
          '"' +
          (site.checked ? " checked" : "") +
          "><span>" +
          esc(site.host) +
          "</span></label>"
      )
      .join("");
    $("#siteCount").textContent =
      "已选 " + state.sites.filter((s) => s.checked).length + " / " + state.sites.length;
  }

  function scanLogLine(text, kind) {
    state.scanLog.push({ text, kind });
    if (state.scanLog.length > 400) state.scanLog.shift();
    const box = $("#scanLog");
    box.innerHTML = state.scanLog
      .slice(-200)
      .map((line) => '<div class="' + (line.kind || "") + '">' + esc(line.text) + "</div>")
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  function setProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    $("#scanBar").style.width = pct + "%";
  }

  function scanOptions() {
    const mode = ($$('input[name="scanMode"]').find((el) => el.checked) || {}).value || "fast";
    return {
      mode,
      aiReview: $("#scanAi").checked,
      skipScanned: $("#scanSkip").checked,
      delayMs: Number($("#scanDelay").value) || 0,
      concurrency: Number($("#scanConcurrency").value) || 1,
      maxSites: Number($("#scanMaxSites").value) || 300,
    };
  }

  async function startScan() {
    let sites = state.sites.filter((s) => s.checked);
    if (!sites.length) {
      toast("请先选择要扫描的站点", "err");
      return;
    }
    if (!state.settings || !state.settings.ai) {
      await loadConfig();
    }
    const opts = scanOptions();
    state.scanning = true;
    state.aiCalls = 0;
    state.scanFindings = [];
    state.scanSelected = new Set();
    state.scanLog = [];
    state.scannedHosts = new Set(sites.map((s) => s.host));
    $("#btnStartScan").disabled = true;
    $("#btnStopScan").disabled = false;
    $("#scanLog").innerHTML = "";
    if (opts.skipScanned) {
      const cacheRes = await UI.send({ type: "zz:scan:cache" });
      const cache = (cacheRes && cacheRes.cache) || {};
      const before = sites.length;
      const day = 24 * 60 * 60 * 1000;
      sites = sites.filter((s) => !cache[s.host] || Date.now() - (cache[s.host].at || 0) > 3 * day);
      if (before !== sites.length) scanLogLine("已跳过 " + (before - sites.length) + " 个 3 天内扫描过的站点");
      if (!sites.length) {
        scanLogLine("没有需要扫描的站点（可取消勾选「跳过 3 天内扫过的站点」）");
        state.scanning = false;
        $("#btnStartScan").disabled = false;
        $("#btnStopScan").disabled = true;
        return;
      }
    }
    scanLogLine("开始扫描 " + sites.length + " 个站点（" + (opts.mode === "fast" ? "快扫" : "渲染扫描") + "）");
    await saveSettings(
      {
        scanning: {
          mode: opts.mode,
          aiReview: opts.aiReview,
          skipScanned: opts.skipScanned,
          delayMs: opts.delayMs,
          concurrency: opts.concurrency,
          maxSites: opts.maxSites,
        },
      },
      true
    );
    if (opts.mode === "fast") await runFastScan(sites, opts);
    else runRenderScan(sites, opts);
  }

  async function runFastScan(sites, opts) {
    const aiEnabled = state.settings.ai.enabled && opts.aiReview;
    if (opts.aiReview && !state.settings.ai.enabled) {
      scanLogLine("AI 未启用，本次仅做本地启发式分析（在「AI 识别」面板启用后可复核）");
    }
    let done = 0;
    const queue = sites.slice();
    const workers = Array.from({ length: Math.max(1, Math.min(3, opts.concurrency)) }, () => worker());
    await Promise.all(workers);
    finishScan(sites.length, done);

    async function worker() {
      while (queue.length) {
        const site = queue.shift();
        if (!state.scanning) return;
        try {
          const res = await fastScanSite(site, opts, aiEnabled);
          done++;
          setProgress(done, sites.length);
          const found = (res.findings || []).length;
          if (res.error) {
            scanLogLine("× " + site.host + "：" + res.error, "err");
          } else {
            const found = (res.findings || []).length;
            scanLogLine(
              "√ " + site.host + "：候选 " + res.candidates + " 个" + (found ? "，生成 " + found + " 条待审规则" : "，未发现广告"),
              found ? "ok" : ""
            );
            addScanFindings(res.findings || []);
          }
        } catch (e) {
          done++;
          setProgress(done, sites.length);
          scanLogLine("× " + site.host + "：" + ((e && e.message) || "失败"), "err");
        }
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      }
    }
  }

  async function fastScanSite(site, opts, aiEnabled) {
    const res = await fetch(site.url, { credentials: "omit", redirect: "follow", cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const detected = Detector.collectFromDocument(doc, { threshold: 20, cap: 40, url: site.url });
    if (!detected.ok) throw new Error(detected.error || "解析失败");
    const candidates = detected.candidates || [];
    if (!candidates.length) return { candidates: 0, findings: [] };
    if (aiEnabled && state.aiCalls < state.aiBudget) {
      state.aiCalls++;
      const r = await UI.send({
        type: "zz:ai:classify",
        payload: { host: site.host, url: site.url, title: detected.title, candidates },
      });
      if (!r || !r.ok) return { candidates: candidates.length, findings: [], error: "AI：" + ((r && r.error) || "失败") };
      return { candidates: candidates.length, findings: r.findings || [] };
    }
    const r = await UI.send({
      type: "zz:findings:add-local",
      payload: { host: site.host, url: site.url, title: detected.title, candidates },
    });
    return { candidates: candidates.length, findings: (r && r.findings) || [] };
  }

  function runRenderScan(sites, opts) {
    try {
      state.port = api.runtime.connect({ name: "zz-scan" });
      state.port.onMessage.addListener(onPortMessage);
      state.port.onDisconnect.addListener(() => {
        state.port = null;
        if (state.scanning) {
          scanLogLine("× 后台连接已断开（服务工作线程可能被浏览器回收），扫描已中断", "err");
          finishScan(0, 0);
        }
      });
      state.port.postMessage({ type: "zz:scan:start", payload: Object.assign({ sites }, opts) });
    } catch (e) {
      scanLogLine("× 无法启动后台扫描：" + e.message, "err");
      state.scanning = false;
      $("#btnStartScan").disabled = false;
      $("#btnStopScan").disabled = true;
    }
  }

  function onPortMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "zz:scan:started") {
      setProgress(0, msg.payload.total);
      if (msg.payload.skippedByLimit) {
        scanLogLine("跳过 " + msg.payload.skippedByLimit + " 个站点（超出上限）");
      }
      return;
    }
    if (msg.type === "zz:scan:progress") {
      const p = msg.payload;
      setProgress(p.index, p.total);
      if (p.status === "done") {
        scanLogLine("√ " + p.site + "：候选 " + (p.candidates || 0) + " 个，生成 " + p.findings + " 条待审规则", p.findings ? "ok" : "");
      } else {
        scanLogLine("× " + p.site + "：" + (p.error || "失败"), "err");
      }
      return;
    }
    if (msg.type === "zz:scan:log") {
      scanLogLine((msg.payload.level === "warn" ? "! " : "") + msg.payload.site + "：" + msg.payload.message, "err");
      return;
    }
    if (msg.type === "zz:scan:done") {
      if (msg.payload.error) scanLogLine("× " + msg.payload.error, "err");
      finishScan(msg.payload.total || 0, msg.payload.done || 0);
      if (msg.payload.aiCalls) scanLogLine("AI 调用 " + msg.payload.aiCalls + " 次");
      loadScanResults();
    }
  }

  async function loadScanResults() {
    const res = await UI.send({ type: "zz:findings:list", payload: { status: "pending" } });
    const hosts = state.scannedHosts || new Set();
    const list = ((res && res.findings) || []).filter((f) => !hosts.size || hosts.has(f.host));
    const added = addScanFindings(list.slice(0, 200));
    scanLogLine(added ? "已载入 " + added + " 条待审结果" : "没有新的待审结果");
    await loadFindings();
  }

  function finishScan(total, done) {
    state.scanning = false;
    $("#btnStartScan").disabled = false;
    $("#btnStopScan").disabled = true;
    $("#btnStopScan").textContent = "停止";
    setProgress(done || 1, total || 1);
    scanLogLine("扫描结束");
  }

  async function applyByIds(ids, scope) {
    if (!ids.length) {
      toast("请先勾选要处理的条目", "err");
      return;
    }
    const res = await UI.send({ type: "zz:findings:apply", payload: { ids, scope } });
    if (res && res.ok && res.rules > 0) {
      toast("已应用 " + res.rules + " 条规则", "ok");
      const appliedSet = new Set(ids);
      for (const id of appliedSet) state.scanSelected.delete(id);
      state.scanFindings = state.scanFindings.filter((f) => !appliedSet.has(f.id));
      renderScanFindings();
    } else if (res && res.ok) {
      toast("这些条目已应用过或规则重复，未新增规则", "err");
      const appliedSet = new Set(ids);
      for (const id of appliedSet) state.scanSelected.delete(id);
      state.scanFindings = state.scanFindings.filter((f) => !appliedSet.has(f.id));
      renderScanFindings();
    } else {
      toast("应用失败：" + ((res && res.error) || "未知错误"), "err");
      return;
    }
    await loadFindings();
  }

  async function renderDiag() {
    const res = await UI.send({ type: "zz:diag" });
    if (!res || !res.ok) return;
    state.diag = res;
    const dnr = res.dnr || {};
    const index = res.index || {};
    const cards = [
      ["已启用网络规则", dnr.applied || 0],
      ["可用外观规则", index.cosmetic || 0],
      ["可拦截域名", index.networkHosts || 0],
      ["自定义规则", res.rules || 0],
      ["待审条目", res.findings || 0],
      ["已统计站点", res.stats || 0],
      ["存储占用", res.usage ? (res.usage / 1024).toFixed(1) + " KB" : "—"],
      ["浏览器", (res.browser.firefox ? "Firefox" : res.browser.safari ? "Safari" : "Chromium") + " · v" + res.browser.version],
    ];
    $("#diagGrid").innerHTML = cards
      .map(([label, value]) => '<div class="zz-card"><span class="zz-small zz-muted">' + esc(label) + "</span><br><b>" + esc(value) + "</b></div>")
      .join("");
    $("#engineBadge").textContent =
      "规则 " + (index.cosmetic + index.network + index.text) + " 条 · 网络生效 " + (dnr.applied || 0) + " 条";
    if (dnr.error && !state.dnrWarned) {
      state.dnrWarned = true;
      toast("网络规则降级：" + dnr.error, "err");
    }
    loadStats();
  }

  async function loadStats() {
    const res = await UI.send({ type: "zz:stats:get" });
    const rows = (res && res.stats) || [];
    const table = $("#statsTable");
    if (!rows.length) {
      table.innerHTML = '<tr><td class="zz-muted">暂无数据，浏览网页后这里会累计每个站点的净化统计。</td></tr>';
      return;
    }
    table.innerHTML =
      "<tr><th>站点</th><th>隐藏元素</th><th>网络拦截</th><th>弹窗</th><th>最后访问</th></tr>" +
      rows
        .slice(0, 300)
        .map(
          (row) =>
            "<tr><td>" +
            esc(row.host) +
            "</td><td>" +
            (row.hidden || 0) +
            "</td><td>" +
            (row.network || 0) +
            "</td><td>" +
            (row.popups || 0) +
            "</td><td>" +
            esc(UI.fmtTime(row.lastSeen)) +
            "</td></tr>"
        )
        .join("");
  }

  function bind() {
    $$(".zz-tab").forEach((btn) =>
      btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")))
    );

    $("#globalEnabled").addEventListener("change", (event) => {
      saveSettings({ enabled: event.target.checked });
    });

    $("#profileSelect").addEventListener("change", (event) => {
      saveSettings({ profile: event.target.value });
    });

    $("#autoFallback").addEventListener("change", (event) => {
      saveSettings({ autoFallback: event.target.checked });
    });

    $("#tempMinutes").addEventListener("change", (event) => {
      const v = Math.max(5, Math.min(720, Number(event.target.value) || 30));
      event.target.value = v;
      saveSettings({ tempMinutes: v });
    });

    $("#autoEnabled").addEventListener("change", (event) => {
      saveSettings({ autonomous: { enabled: event.target.checked } });
    });
    $("#autoApplyFindings").addEventListener("change", (event) => {
      saveSettings({ autonomous: { autoApply: event.target.checked } });
    });
    $("#autoWeekly").addEventListener("change", (event) => {
      saveSettings({ autonomous: { weekly: event.target.checked } });
    });
    $("#autoMinVisits").addEventListener("change", (event) => {
      const v = Math.max(1, Math.min(50, Number(event.target.value) || 3));
      event.target.value = v;
      saveSettings({ autonomous: { minVisits: v } });
    });
    $("#autoMaxSites").addEventListener("change", (event) => {
      const v = Math.max(1, Math.min(50, Number(event.target.value) || 15));
      event.target.value = v;
      saveSettings({ autonomous: { maxSites: v } });
    });
    $("#autoThreshold").addEventListener("change", (event) => {
      const v = Math.max(0.3, Math.min(1, Number(event.target.value) || 0.75));
      event.target.value = v;
      saveSettings({ autonomous: { threshold: v } });
    });
    $("#btnAutoRun").addEventListener("click", async () => {
      $("#btnAutoRun").disabled = true;
      $("#autoState").textContent = "启动中…";
      const res = await UI.send({ type: "zz:autopilot:run" });
      if (!res || !res.ok) {
        toast("自主增强启动失败：" + ((res && res.error) || "未知错误"), "err");
      } else {
        toast("自主增强完成：站点 " + res.sites + "，应用 " + res.applied + " 条", "ok");
      }
      refreshAutopilot();
      loadLearn();
    });
    $("#btnAutoStop").addEventListener("click", async () => {
      await UI.send({ type: "zz:autopilot:stop" });
      refreshAutopilot();
    });
    $("#learnAuto").addEventListener("change", (event) => {
      saveSettings({ learning: { autoApply: event.target.checked } });
    });
    $("#learnMinSites").addEventListener("change", (event) => {
      const v = Math.max(2, Math.min(10, Number(event.target.value) || 2));
      event.target.value = v;
      saveSettings({ learning: { minSites: v } });
    });
    $("#learnList").addEventListener("click", async (event) => {
      const btn = event.target.closest("button[data-learn-apply]");
      if (!btn) return;
      btn.disabled = true;
      const res = await UI.send({ type: "zz:learn:apply", payload: { selector: btn.getAttribute("data-learn-apply") } });
      if (res && res.ok) toast("已升级为通用规则", "ok");
      else toast("升级失败：" + ((res && res.error) || "未知错误"), "err");
      loadLearn();
    });

    $("#videoDir").addEventListener("change", (event) => {
      saveSettings({ toolbox: { videoDir: event.target.value.trim() || "ZeroZen/视频" } });
    });
    $("#imageDir").addEventListener("change", (event) => {
      saveSettings({ toolbox: { imageDir: event.target.value.trim() || "ZeroZen/图片" } });
    });
    $("#articleDir").addEventListener("change", (event) => {
      saveSettings({ toolbox: { articleDir: event.target.value.trim() || "ZeroZen/阅读" } });
    });
    $("#dlConcurrency").addEventListener("change", (event) => {
      const v = Math.max(1, Math.min(8, Number(event.target.value) || 4));
      event.target.value = v;
      saveSettings({ toolbox: { concurrency: v } });
    });
    $("#honestUrl").addEventListener("change", (event) => {
      saveSettings({ honest: { url: event.target.value.trim() } });
    });

    $("#ruleSearch").addEventListener(
      "input",
      debounce(() => {
        state.ruleQuery = $("#ruleSearch").value.trim();
        state.ruleLimit = 200;
        loadRules();
      }, 250)
    );

    $("#ruleSource").addEventListener("change", () => {
      state.ruleSource = $("#ruleSource").value;
      state.ruleLimit = 200;
      loadRules();
    });

    $("#btnShowMore").addEventListener("click", () => {
      state.ruleLimit += 200;
      renderRules();
    });

    $("#btnImport").addEventListener("click", () => {
      $("#importPanel").classList.toggle("zz-hidden");
    });
    $("#btnImportCancel").addEventListener("click", () => $("#importPanel").classList.add("zz-hidden"));

    $("#btnImportText").addEventListener("click", async () => {
      const text = $("#importText").value;
      if (!text.trim()) {
        toast("请先粘贴规则内容", "err");
        return;
      }
      const res = await UI.send({ type: "zz:rules:add", payload: { text, source: "import" } });
      if (res && res.ok) {
        $("#importResult").textContent =
          "导入成功 " + res.added + " 条，重复 " + res.duplicates + " 条，跳过 " +
          (res.skippedCount || 0) + " 条" +
          (res.skipped && res.skipped.length
            ? "；示例：" + res.skipped.slice(0, 3).map((s) => "第" + s.line + "行 " + s.reason).join("；")
            : "");
        toast("导入完成", "ok");
        await loadRules();
      } else {
        toast("导入失败：" + ((res && res.error) || "未知错误"), "err");
      }
    });

    $("#btnImportFile").addEventListener("click", async () => {
      const file = await UI.pickFile(".json,.txt,.list");
      if (!file) return;
      $("#importText").value = file.text.slice(0, 200000);
      toast("已读取 " + file.name + "，点击「导入文本」生效");
    });

    $("#btnExportNative").addEventListener("click", async () => {
      const res = await UI.send({ type: "zz:rules:export", payload: { format: "native", source: state.ruleSource === "all" ? "all" : state.ruleSource } });
      if (res && res.ok) {
        UI.download("zerozen-rules-" + Date.now() + ".json", res.text);
        toast("已导出 " + res.count + " 条规则", "ok");
      }
    });

    $("#btnExportAdblock").addEventListener("click", async () => {
      const res = await UI.send({ type: "zz:rules:export", payload: { format: "adblock", source: state.ruleSource === "all" ? "all" : state.ruleSource } });
      if (res && res.ok) {
        UI.download("zerozen-rules-" + Date.now() + ".txt", res.text);
        toast("已导出 Adblock 格式 " + res.count + " 条", "ok");
      }
    });

    $("#btnCopyRules").addEventListener("click", async () => {
      const res = await UI.send({ type: "zz:rules:export", payload: { format: "native" } });
      if (res && res.ok && (await UI.copy(res.text))) toast("规则 JSON 已复制到剪贴板", "ok");
    });

    $("#btnClearUser").addEventListener("click", async () => {
      if (!confirm("确定清空全部自定义/AI/导入规则？内置规则包不受影响。")) return;
      await UI.send({ type: "zz:rules:clear", payload: {} });
      toast("已清空自定义规则", "ok");
      await loadRules();
    });

    $("#ruleTable").addEventListener("change", async (event) => {
      const input = event.target.closest("input[data-toggle]");
      if (!input) return;
      await UI.send({
        type: "zz:rules:update",
        payload: { id: input.getAttribute("data-toggle"), patch: { enabled: input.checked } },
      });
    });

    $("#ruleTable").addEventListener("click", async (event) => {
      const btn = event.target.closest("button[data-del]");
      if (!btn) return;
      await UI.send({ type: "zz:rules:remove", payload: { ids: [btn.getAttribute("data-del")] } });
      toast("规则已删除", "ok");
      await loadRules();
    });

    $("#btnSaveAi").addEventListener("click", saveAi);
    $("#btnTestAi").addEventListener("click", async () => {
      $("#aiTestResult").textContent = "测试中…";
      await saveAi();
      const res = await UI.send({ type: "zz:ai:test" });
      $("#aiTestResult").textContent = res && res.ok ? "连接成功（" + res.ms + "ms）" : "失败：" + ((res && res.error) || "未知错误");
    });

    $("#btnLoadBookmarks").addEventListener("click", () => loadBookmarks($("#folderSelect").value));
    $("#folderSelect").addEventListener("change", () => loadBookmarks($("#folderSelect").value));

    $("#btnMergeUrls").addEventListener("click", () => {
      const urls = $("#scanUrls")
        .value.split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => (/^https?:/i.test(line) ? line : "https://" + line.replace(/^\/+/, "")));
      const list = [];
      for (const url of urls) {
        const host = hostOf(url);
        if (!host) continue;
        list.push({ host, url, title: "", checked: true });
      }
      mergeSites(list);
      $("#scanUrls").value = "";
    });

    $("#btnSelectAll").addEventListener("click", () => {
      state.sites.forEach((s) => (s.checked = true));
      renderSites();
    });
    $("#btnSelectNone").addEventListener("click", () => {
      state.sites.forEach((s) => (s.checked = false));
      renderSites();
    });
    $("#btnClearSites").addEventListener("click", () => {
      state.sites = [];
      renderSites();
    });
    $("#siteGrid").addEventListener("change", (event) => {
      const input = event.target.closest("input[data-site]");
      if (!input) return;
      const idx = Number(input.getAttribute("data-site"));
      if (state.sites[idx]) state.sites[idx].checked = input.checked;
      $("#siteCount").textContent =
        "已选 " + state.sites.filter((s) => s.checked).length + " / " + state.sites.length;
    });

    $("#btnStartScan").addEventListener("click", startScan);
    $("#btnStopScan").addEventListener("click", async () => {
      state.scanning = false;
      if (state.port) state.port.postMessage({ type: "zz:scan:stop" });
      else await UI.send({ type: "zz:scan:stop" });
      scanLogLine("已请求停止");
      $("#btnStopScan").disabled = true;
    });

    $("#btnApplyFindings").addEventListener("click", () =>
      applyByIds(selectedFindingIds($("#scanFindings")), "site")
    );
    $("#btnApplyFindingsGlobal").addEventListener("click", () =>
      applyByIds(selectedFindingIds($("#scanFindings")), "global")
    );
    $("#btnDismissFindings").addEventListener("click", () => dismissIds(selectedFindingIds($("#scanFindings"))));

    $("#btnRefreshFindings").addEventListener("click", loadFindings);
    $("#findingStatus").addEventListener("change", () => {
      state.findingStatus = $("#findingStatus").value;
      loadFindings();
    });
    $("#findingHost").addEventListener(
      "input",
      debounce(() => {
        state.findingHost = $("#findingHost").value.trim();
        loadFindings();
      }, 300)
    );
    $("#btnApplySel").addEventListener("click", () => applyByIds(selectedFindingIds($("#findingList")), "site"));
    $("#btnApplySelGlobal").addEventListener("click", () => applyByIds(selectedFindingIds($("#findingList")), "global"));
    $("#btnDismissSel").addEventListener("click", () => dismissIds(selectedFindingIds($("#findingList"))));
    $("#btnDeleteSel").addEventListener("click", async () => {
      const ids = selectedFindingIds($("#findingList"));
      if (!ids.length) return toast("请先勾选条目", "err");
      await UI.send({ type: "zz:findings:remove", payload: { ids } });
      toast("已删除 " + ids.length + " 条记录", "ok");
      await loadFindings();
    });
    $("#findingList").addEventListener("click", async (event) => {
      const btn = event.target.closest("button[data-finding-del]");
      if (!btn) return;
      await UI.send({ type: "zz:findings:remove", payload: { ids: [btn.getAttribute("data-finding-del")] } });
      await loadFindings();
    });
    $("#scanFindings").addEventListener("change", (event) => {
      const input = event.target.closest("input[data-finding]");
      if (!input) return;
      const id = input.getAttribute("data-finding");
      if (input.checked) state.scanSelected.add(id);
      else state.scanSelected.delete(id);
      $("#applyInfo").textContent =
        "显示 " + state.scanFindings.length + " 条，已选 " + state.scanSelected.size + " 条";
    });
    $("#scanFindings").addEventListener("click", async (event) => {
      const btn = event.target.closest("button[data-finding-del]");
      if (!btn) return;
      const id = btn.getAttribute("data-finding-del");
      state.scanFindings = state.scanFindings.filter((f) => f.id !== id);
      state.scanSelected.delete(id);
      renderScanFindings();
    });

    $("#btnSyncDnr").addEventListener("click", async () => {
      const res = await UI.send({ type: "zz:dnr:sync" });
      toast(res && !res.error ? "网络规则已同步：" + (res.applied || 0) + " 条" : "同步降级：" + ((res && res.error) || "未知"), res && !res.error ? "ok" : "err");
      renderDiag();
    });
    $("#btnRefreshDiag").addEventListener("click", renderDiag);
    $("#btnExportAll").addEventListener("click", async () => {
      const res = await UI.send({ type: "zz:rules:export", payload: { format: "native" } });
      if (res && res.ok) UI.download("zerozen-all-rules.json", res.text);
    });
    $("#btnResetStats").addEventListener("click", async () => {
      if (!confirm("清除所有站点的统计计数与扫描记录？")) return;
      await UI.send({ type: "zz:stats:reset" });
      toast("统计已清除", "ok");
      await renderDiag();
    });
    $("#btnResetAll").addEventListener("click", async () => {
      if (!confirm("恢复默认设置？自定义规则与待审记录会保留。")) return;
      const res = await UI.send({ type: "zz:settings:reset" });
      if (res && res.ok) {
        toast("已恢复默认设置，正在刷新…", "ok");
        setTimeout(() => location.reload(), 600);
      } else {
        toast("重置失败：" + ((res && res.error) || "未知错误"), "err");
      }
    });
  }

  function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  async function dismissIds(ids) {
    if (!ids.length) return toast("请先勾选条目", "err");
    await UI.send({ type: "zz:findings:dismiss", payload: { ids } });
    toast("已忽略 " + ids.length + " 条", "ok");
    const set = new Set(ids);
    for (const id of set) state.scanSelected.delete(id);
    state.scanFindings = state.scanFindings.filter((f) => !set.has(f.id));
    renderScanFindings();
    await loadFindings();
  }

  async function init() {
    bind();
    await loadConfig();
    await loadRules();
    await loadFindings();
    renderScanFindings();
    renderDiag();
    renderRacksCounts();
    const hash = (location.hash || "").replace("#", "");
    if (hash && $(`[data-tab="${hash}"]`)) switchTab(hash);
    const status = await UI.send({ type: "zz:scan:status" });
    if (status && status.running) {
      toast("后台扫描进行中：" + status.done + "/" + status.total + "，可打开批量扫描查看", "ok");
    }
    setInterval(async () => {
      if (state.tab === "stats") await renderDiag();
    }, 5000);
  }

  init();
})();

(function () {
  const $ = (s) => document.querySelector(s);
  const T = (globalThis.ZZ && globalThis.ZZ.T) || ((s) => s);

  function firstNumber(text) {
    const m = String(text || "").match(/([\d][\d,]*)/);
    return m ? m[1].replace(/,/g, "") : "—";
  }

  function sync() {
    const title = $("#ovTitle");
    if (!title) return;
    const globalOn = !!( $("#globalEnabled") && $("#globalEnabled").checked);
    const engine = ( $("#engineBadge") && $("#engineBadge").textContent ) || "";
    const pending = Number(firstNumber(( $("#findingsBadge") && $("#findingsBadge").textContent ) || "0")) || 0;
    const customRaw = firstNumber(( $("#ruleCount") && $("#ruleCount").textContent ) || "");
    const custom = customRaw === "—" ? "0" : customRaw;
    const networkMatch = engine.match(/网络生效\s*([\d,]+)/);

    title.textContent = T(globalOn ? "防护正在运行" : "全局防护已关闭");
    const sub = $("#ovSub");
    if (sub) sub.textContent = engine && !/加载中/.test(engine) ? engine : T("正在读取规则状态…");

    const pill = $("#ovPill");
    if (pill) {
      pill.className = "zz-ov-pill" + (globalOn ? "" : " is-off");
      const span = pill.querySelector("span");
      if (span) span.textContent = T(globalOn ? "正常" : "已关闭");
    }

    const rules = $("#ovRules");
    if (rules) rules.textContent = networkMatch ? networkMatch[1].replace(/,/g, "") : ( /\d/.test(engine) ? firstNumber(engine) : "—" );
    const pendingEl = $("#ovPending");
    if (pendingEl) pendingEl.textContent = String(pending);
    const customEl = $("#ovCustom");
    if (customEl) customEl.textContent = custom;

    const todo = $("#ovTodoText");
    if (todo) todo.textContent = pending ? T("$1 项建议等待你的判断", pending) : T("当前没有待审项");
  }

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-goto]");
    if (!btn) return;
    const tab = document.querySelector('.zz-tab[data-tab="' + btn.getAttribute("data-goto") + '"]');
    if (tab) tab.click();
  });

  const globalSwitch = $("#globalEnabled");
  if (globalSwitch) globalSwitch.addEventListener("change", () => setTimeout(sync, 60));

  setInterval(sync, 1200);
  sync();
})();

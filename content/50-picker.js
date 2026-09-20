(function () {
  const ZZ = globalThis.ZZ;
  const u = ZZ.u;
  if (!u) return;

  const state = {
    active: false,
    target: null,
    overlay: null,
    box: null,
    label: null,
    panel: null,
    gen: "",
    scrollTimer: null,
  };

  function uiRoot() {
    if (state.overlay) return state.overlay;
    const root = document.createElement("div");
    root.className = "zz-picker-root";
    root.setAttribute("data-zz-ui", "1");
    const box = document.createElement("div");
    box.className = "zz-picker-box";
    const label = document.createElement("div");
    label.className = "zz-picker-label";
    root.appendChild(box);
    root.appendChild(label);
    (document.body || document.documentElement).appendChild(root);
    state.overlay = root;
    state.box = box;
    state.label = label;
    return root;
  }

  function position() {
    if (!state.target || !state.target.isConnected) {
      cancel();
      return;
    }
    const r = state.target.getBoundingClientRect();
    state.box.style.left = r.left + "px";
    state.box.style.top = r.top + "px";
    state.box.style.width = Math.max(2, r.width) + "px";
    state.box.style.height = Math.max(2, r.height) + "px";
    const sel = u.uniqueSelector(state.target) || ZZ.T("(无法生成唯一选择器)");
    const tag = state.target.tagName.toLowerCase();
    state.label.textContent = tag + "  ·  " + Math.round(r.width) + "×" + Math.round(r.height);
    state.label.title = sel;
    const labelTop = r.top > 34 ? r.top - 26 : r.top + 4;
    state.label.style.left = Math.max(4, r.left) + "px";
    state.label.style.top = labelTop + "px";
  }

  function inUi(event) {
    const t = event.target;
    return !!(t && t.closest && t.closest("[data-zz-ui]"));
  }

  function onMove(event) {
    if (!state.active || state.panel) return;
    const el = elementFromPoint(event);
    if (!el || el === state.target) return;
    state.target = el;
    position();
  }

  function elementFromPoint(event) {
    const stack = document.elementsFromPoint ? document.elementsFromPoint(event.clientX, event.clientY) : [];
    for (const el of stack) {
      if (el === state.overlay || el === state.panel) continue;
      if (el.closest && el.closest("[data-zz-ui]")) continue;
      if (el === document.documentElement || el === document.body) continue;
      return el;
    }
    return document.elementFromPoint(event.clientX, event.clientY);
  }

  function onClick(event) {
    if (!state.active || inUi(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    const el = elementFromPoint(event);
    if (!el) return;
    state.target = el;
    position();
    openPanel();
  }

  function onKey(event) {
    if (!state.active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (state.panel) closePanel();
      else cancel();
      return;
    }
    if (!state.target) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const parent = state.target.parentElement;
      if (parent && parent !== document.body) {
        state.target = parent;
        position();
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const child = Array.from(state.target.children).find((c) => !c.hasAttribute("data-zz-ui"));
      if (child) {
        state.target = child;
        position();
      }
    } else if (event.key === "Enter" && !state.panel) {
      event.preventDefault();
      openPanel();
    }
  }

  function openPanel() {
    closePanel();
    const el = state.target;
    if (!el) return;
    state.gen = u.genericSelector(el) || "";
    const selector = u.uniqueSelector(el);
    const panel = document.createElement("div");
    panel.className = "zz-picker-panel";
    panel.setAttribute("data-zz-ui", "1");
    panel.innerHTML = [
      '<div class="zz-picker-head">' + ZZ.T("屏蔽元素") + '<button class="zz-picker-x" data-act="cancel">×</button></div>',
      '<input class="zz-picker-input" data-role="selector" spellcheck="false">',
      '<label class="zz-picker-opt"><input type="checkbox" data-role="global"> ' + ZZ.T("应用到所有网站（通用规则）") + "</label>",
      '<div class="zz-picker-actions-row">',
      '  <label class="zz-picker-radio"><input type="radio" name="zz-act" value="hide" checked> ' + ZZ.T("隐藏") + "</label>",
      '  <label class="zz-picker-radio"><input type="radio" name="zz-act" value="remove"> ' + ZZ.T("移除") + "</label>",
      "</div>",
      '<div class="zz-picker-hint" data-role="hint"></div>',
      '<div class="zz-picker-actions">',
      '  <button class="zz-btn zz-btn-primary" data-act="apply">' + ZZ.T("应用") + "</button>",
      '  <button class="zz-btn" data-act="allow">' + ZZ.T("在此站放行同类元素") + "</button>",
      '  <button class="zz-btn zz-btn-ghost" data-act="cancel">' + ZZ.T("取消") + "</button>",
      "</div>",
    ].join("");
    document.body.appendChild(panel);
    state.panel = panel;
    const input = panel.querySelector('[data-role="selector"]');
    input.value = selector;
    const globalCb = panel.querySelector('[data-role="global"]');
    if (!state.gen) {
      globalCb.disabled = true;
      globalCb.parentElement.title = ZZ.T("该元素没有可复用的通用选择器");
    }
    const hint = panel.querySelector('[data-role="hint"]');
    const updateHint = () => {
      const sel = input.value.trim();
      const count = u.matchCount(sel, 9999);
      const scope = globalCb.checked ? ZZ.T("所有网站") : u.host();
      hint.textContent =
        count < 0
          ? ZZ.T("选择器无效")
          : count === 0
          ? ZZ.T("当前不匹配任何元素（仍可保存规则）")
          : ZZ.T("将影响 $1 个元素 · 作用范围：$2", count, scope);
      hint.classList.toggle("zz-picker-hint-warn", count < 0 || count > 300);
    };
    input.addEventListener("input", updateHint);
    globalCb.addEventListener("change", () => {
      if (globalCb.checked && state.gen) input.value = state.gen;
      else if (!globalCb.checked) input.value = u.uniqueSelector(state.target) || input.value;
      updateHint();
    });
    updateHint();

    const r = el.getBoundingClientRect();
    const panelWidth = 320;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - panelWidth - 8);
    const top = r.bottom + 8 + 220 < window.innerHeight ? r.bottom + 8 : Math.max(8, r.top - 220);
    panel.style.left = left + "px";
    panel.style.top = top + "px";

    panel.addEventListener("click", (event) => {
      const act = event.target && event.target.getAttribute && event.target.getAttribute("data-act");
      if (!act) return;
      event.preventDefault();
      event.stopPropagation();
      if (act === "cancel") {
        closePanel();
        cancel();
      } else if (act === "apply") {
        apply(input.value.trim(), globalCb.checked, panel.querySelector('input[name="zz-act"]:checked').value);
      } else if (act === "allow") {
        allow(input.value.trim(), globalCb.checked);
      }
    });
  }

  function closePanel() {
    if (state.panel) {
      state.panel.remove();
      state.panel = null;
    }
  }

  async function apply(selector, isGlobal, action) {
    const err = checkSelector(selector, isGlobal);
    if (err) {
      const hint = state.panel && state.panel.querySelector('[data-role="hint"]');
      if (hint) {
        hint.textContent = err;
        hint.classList.add("zz-picker-hint-warn");
      }
      return;
    }
    const res = await ZZ.send({
      type: "zz:picker:result",
      payload: {
        selector,
        genericSelector: state.gen,
        scope: isGlobal ? "global" : "site",
        action,
        host: u.host(),
      },
    });
    toast(res && res.ok ? ZZ.T("已添加屏蔽规则") : ZZ.T("添加失败：$1", (res && res.error) || ZZ.T("未知错误")));
    stop();
  }

  async function allow(selector, isGlobal) {
    const res = await ZZ.send({
      type: "zz:picker:allow",
      payload: { selector, scope: isGlobal ? "global" : "site", host: u.host() },
    });
    toast(res && res.ok ? ZZ.T("已放行") : ZZ.T("操作失败：$1", (res && res.error) || ZZ.T("未知错误")));
    stop();
  }

  function checkSelector(selector, isGlobal) {
    if (!selector) return ZZ.T("请填写选择器");
    if (!u.isValidSelector(selector)) return ZZ.T("选择器语法无效");
    const count = u.matchCount(selector, 9999);
    if (count > 400) return ZZ.T("选择器匹配 $1 个元素，范围过大，请调整", count);
    if (isGlobal && count > 200) return ZZ.T("通用规则匹配元素过多，请缩小范围");
    return "";
  }

  function toast(text) {
    const el = document.createElement("div");
    el.className = "zz-toast zz-toast-visible";
    el.setAttribute("data-zz-ui", "1");
    el.textContent = text;
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.classList.remove("zz-toast-visible"), 2400);
    setTimeout(() => el.remove(), 3000);
  }

  function start() {
    if (state.active) return;
    state.active = true;
    uiRoot();
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", stopPropagation, true);
    document.addEventListener("mouseup", stopPropagation, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", position, true);
    ZZ.Detector && ZZ.Detector.clearHighlight();
  }

  function stopPropagation(event) {
    if (!state.active || inUi(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onScroll() {
    if (!state.active) return;
    if (state.scrollTimer) return;
    state.scrollTimer = setTimeout(() => {
      state.scrollTimer = null;
      position();
    }, 60);
  }

  function cancel() {
    toast(ZZ.T("已取消元素选取"));
    stop();
  }

  function stop() {
    state.active = false;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", stopPropagation, true);
    document.removeEventListener("mouseup", stopPropagation, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", position, true);
    closePanel();
    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
      state.box = null;
      state.label = null;
    }
    state.target = null;
  }

  ZZ.Picker = {
    start,
    stop,
    isActive() {
      return state.active;
    },
    init() {
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "z" || event.key === "Z")) {
            event.preventDefault();
            start();
          }
        },
        true
      );
    },
  };
})();

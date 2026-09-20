(function () {
  const ZZ = globalThis.ZZ;

  const LIST = [
    {
      id: "compat",
      get name() {
        return ZZ.T("兼容");
      },
      get desc() {
        return ZZ.T("仅通用拦截与视频规则，最大化站点兼容性");
      },
      packs: ["core", "adnetworks", "adult", "youtube", "video-cn", "live"],
      flags: { textRules: false, unlockScroll: false, aggressive: false },
    },
    {
      id: "standard",
      get name() {
        return ZZ.T("标准");
      },
      get desc() {
        return ZZ.T("推荐：全部内置规则，平衡拦截与兼容");
      },
      packs: null,
      flags: { textRules: true, unlockScroll: "auto", aggressive: false },
    },
    {
      id: "strict",
      get name() {
        return ZZ.T("严格");
      },
      get desc() {
        return ZZ.T("全部规则 + 移除式处理与强制解锁滚动，可能影响站点功能");
      },
      packs: null,
      flags: { textRules: true, unlockScroll: true, aggressive: true },
    },
  ];

  const IDS = LIST.map((p) => p.id);

  function get(id) {
    return LIST.find((p) => p.id === id) || LIST[1];
  }

  function packMap(profileId, enabledPacks) {
    const base = Object.assign({}, enabledPacks || {});
    const profile = get(profileId);
    if (!profile.packs) return base;
    const out = {};
    for (const id of Object.keys(base)) {
      out[id] = base[id] !== false && profile.packs.indexOf(id) >= 0;
    }
    return out;
  }

  function flags(profileId) {
    return Object.assign({}, get(profileId).flags);
  }

  ZZ.Profiles = { LIST, IDS, get, packMap, flags };
})();

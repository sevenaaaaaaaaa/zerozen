(function () {
  const ZZ = globalThis.ZZ;

  const LIST = [
    {
      id: "compat",
      name: "兼容",
      desc: "仅通用拦截与视频规则，最大化站点兼容性",
      packs: ["core", "adnetworks", "adult", "youtube", "video-cn", "live"],
      flags: { textRules: false, unlockScroll: false, aggressive: false },
    },
    {
      id: "standard",
      name: "标准",
      desc: "推荐：全部内置规则，平衡拦截与兼容",
      packs: null,
      flags: { textRules: true, unlockScroll: "auto", aggressive: false },
    },
    {
      id: "strict",
      name: "严格",
      desc: "全部规则 + 移除式处理与强制解锁滚动，可能影响站点功能",
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

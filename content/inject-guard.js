(function () {
  if (window.__zzGuardInstalled) return;
  window.__zzGuardInstalled = true;

  const script = document.currentScript;
  const token = (script && script.dataset && script.dataset.zzToken) || "";

  const state = {
    enabled: true,
    notifications: true,
    closeBlankTargets: false,
  };

  function report(kind, url) {
    try {
      window.postMessage({ __zz: "popup-blocked", token, kind, url: String(url || "").slice(0, 200) }, "*");
    } catch (e) {}
  }

  function userActive() {
    try {
      if (navigator.userActivation) return navigator.userActivation.isActive === true;
    } catch (e) {}
    return true;
  }

  function isAdUrl(url) {
    if (!url) return false;
    try {
      const href = String(url);
      if (/^(javascript:|about:blank|blob:)/i.test(href)) return false;
      const host = new URL(href, location.href).hostname.toLowerCase();
      if (!host || host === location.hostname) return false;
      return /(^|\.)(magsrv|pemsrv|wpadmngr|exoclick|exosrv|realsrv|exdynsrv|juicyads|juicycdn|trafficjunky|tsyndicate|trafficstars|popads|popcash|propellerads|propellerpops|onclasrv|clickadu|adcash|adsterra|adskeeper|hilltopads|adspyglass|traffichunt|zeropark|plugrush|twinrdsrv|twinrdengine|trafficfactory|galaksion|clickaine|ad-maven|stripchat|chaturbate)\./.test(
        "." + host + "."
      );
    } catch (e) {
      return false;
    }
  }

  const origOpen = window.open;
  if (typeof origOpen === "function") {
    window.open = function (url, name, features) {
      if (state.enabled && (!userActive() || isAdUrl(url))) {
        report("open", url);
        return null;
      }
      return origOpen.apply(this, arguments);
    };
  }

  if (window.Notification && window.Notification.requestPermission) {
    const origPermission = window.Notification.requestPermission.bind(window.Notification);
    try {
      window.Notification.requestPermission = function (callback) {
        if (state.enabled && state.notifications && !userActive()) {
          report("notification", "");
          if (typeof callback === "function") callback("denied");
          return Promise.resolve("denied");
        }
        return origPermission(callback);
      };
    } catch (e) {}
  }

  if (window.HTMLAnchorElement && HTMLAnchorElement.prototype.click) {
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (state.enabled && this.hasAttribute && this.hasAttribute("data-zz-guard")) return;
      return origClick.apply(this, arguments);
    };
  }

  try {
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__zz !== "guard-config" || data.token !== token) return;
      state.enabled = data.enabled !== false;
      if (typeof data.notifications === "boolean") state.notifications = data.notifications;
    });
    document.addEventListener(
      "click",
      (event) => {
        if (!state.enabled) return;
        const a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
        if (!a) return;
        if (!isAdUrl(a.href)) return;
        event.preventDefault();
        event.stopPropagation();
        report("link", a.href);
      },
      true
    );
  } catch (e) {}

  window.__zzGuardState = state;
})();

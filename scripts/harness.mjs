import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = new URL("..", import.meta.url).pathname;

export function makeSandbox(extra = {}) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    URL,
    fetch: async () => {
      throw new Error("fetch not available in sandbox");
    },
    ...extra,
  };
  sandbox.globalThis = sandbox;
  sandbox.chrome = {
    runtime: {
      getManifest: () => ({ version: "0.0.0-test" }),
      getURL: (p) => "chrome-extension://test/" + p,
      onMessage: { addListener() {} },
      onConnect: { addListener() {} },
    },
    storage: {
      local: {
        async get() {
          return {};
        },
        async set() {},
      },
    },
    declarativeNetRequest: {
      async getDynamicRules() {
        return [];
      },
      async updateDynamicRules() {},
    },
  };
  vm.createContext(sandbox);
  return sandbox;
}

export function load(sandbox, ...relPaths) {
  for (const rel of relPaths) {
    const file = join(ROOT, rel);
    const src = readFileSync(file, "utf8");
    vm.runInContext(src, sandbox, { filename: rel });
  }
  return sandbox;
}

export function loadRuleEngine(sandbox) {
  return load(
    sandbox,
    "background/lib-compat.js",
    "i18n/i18n.js",
    "i18n/dict-en.js",
    "background/rule-format.js",
    "background/profiles.js",
    "background/rule-index.js"
  );
}

export function assert(cond, label) {
  if (cond) {
    console.log("  ok   " + label);
    return true;
  }
  console.error("  FAIL " + label);
  process.exitCode = 1;
  return false;
}

export function assertEqual(actual, expected, label) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    console.log("  ok   " + label);
    return true;
  }
  console.error("  FAIL " + label + "\n       actual:   " + JSON.stringify(actual) + "\n       expected: " + JSON.stringify(expected));
  process.exitCode = 1;
  return false;
}

const UNSAFE = /[{}\@;]|url\s*\(/i;
const BROAD = /^(\*|html|body|:root)$/i;
const RISKY_SUBSTRING_TOKEN0 = new Set([
  "ad", "ads", "down", "load", "read", "head", "thread", "bread", "spread",
  "upload", "add", "side", "wide", "mask", "banner", "fixed",
]);

export function riskySubstring(selector) {
  for (const m of String(selector || "").matchAll(/\[(class|id)\*=\s*'([^']*)'\]/gi)) {
    const value = m[2];
    if (/^(ad|ads)[-_]/i.test(value)) return `[${m[1]}*='${value}']`;
    const token0 = value.split(/[-_]/)[0].toLowerCase();
    if (RISKY_SUBSTRING_TOKEN0.has(token0) && /[-_]/.test(value)) return `[${m[1]}*='${value}']`;
    if (["mask-ad", "ad-mask", "fixed-ad"].includes(value.toLowerCase())) return `[${m[1]}*='${value}']`;
  }
  return null;
}

export function looksTooBroad(selector) {
  const s = String(selector || "").trim();
  if (BROAD.test(s)) return true;
  if (/^\*/.test(s)) return true;
  const classMatch = /^\[class([*^$]?)=['"]([^'"]+)['"]\]$/i.exec(s);
  if (classMatch) {
    const op = classMatch[1] || "";
    const value = classMatch[2].trim();
    const deny = ["ad", "ads", "ad-", "a-", "b-", "c-", "d-", "e-", "m-", "s-", "x-", "gg", "box", "div"];
    if (op === "*" && (value.length < 4 || deny.includes(value.toLowerCase()))) return true;
    if ((op === "$" || op === "") && value.length < 4) return true;
    if (op === "^" && value.length < 3) return true;
  }
  return false;
}

export function checkCosmeticSelector(selector) {
  const sel = String(selector || "");
  if (!sel) return "empty selector";
  if (UNSAFE.test(sel)) return "unsafe selector";
  if (looksTooBroad(sel)) return "dangerously broad selector";
  if (/^[a-z]+$/.test(sel) && !["iframe", "ins", "embed"].includes(sel)) {
    return "single tag selector";
  }
  const risky = riskySubstring(sel);
  if (risky) return `substring selector ${risky} can match inside other words - use [class^='..'], [class*=' ..'] instead`;
  return null;
}

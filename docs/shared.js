// Shared client-side helpers for the static GitHub Pages demo.
// (The production app keeps this state server-side; here it lives in the
// browser's localStorage so the demo needs no backend.)

export const CHARITY_NAME = "Shri Example Temple Trust";
export const GIFT_AID_RATE = 0.25;

export const TAXPAYER_STATEMENT =
  "I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital " +
  "Gains Tax in the current tax year than the amount of Gift Aid claimed on all my " +
  "donations it is my responsibility to pay any difference.";

export const DECLARATION_FOOTER =
  "Please notify the charity if you: want to cancel this declaration; change your " +
  "name or home address; or no longer pay sufficient tax on your income and/or " +
  "capital gains. If you pay Income Tax at the higher or additional rate you can " +
  "claim the additional relief via your Self-Assessment tax return.";

export const pounds = (pence) => "£" + (pence / 100).toFixed(2);

export function normalisePostcode(raw) {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "");
  if (s.length < 5) return s;
  return s.slice(0, s.length - 3) + " " + s.slice(s.length - 3);
}

// Base URL of the site (works under the /repo/ path on GitHub Pages).
export function siteBase() {
  return location.href.replace(/[^/]*(\?.*)?$/, "");
}

const KEY = "giftaid_declarations";
export function loadDeclarations() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveDeclaration(d) {
  const all = loadDeclarations();
  all.push(d);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export const PROFILE_KEY = "giftaid_profile";

// Gift Aid declaration wording (verbatim HMRC) and helpers. The exact wording a
// donor agreed to is versioned and stored with each declaration as audit
// evidence that the UK-taxpayer statement was shown.
// See docs/hmrc-gift-aid-guidance.md.

export const DECLARATION_VERSION = "2024-hmrc-v1";

export const TAXPAYER_STATEMENT =
  "I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital " +
  "Gains Tax in the current tax year than the amount of Gift Aid claimed on all my " +
  "donations it is my responsibility to pay any difference.";

export function singleScopeLine(charityName, amountText) {
  return `I want to Gift Aid my donation of ${amountText} to ${charityName}.`;
}

export function enduringScopeLine(charityName) {
  return `I want to Gift Aid any donations I make in the future or have made in the past 4 years to ${charityName}.`;
}

export const DECLARATION_FOOTER =
  "Please notify the charity if you: want to cancel this declaration; change your " +
  "name or home address; or no longer pay sufficient tax on your income and/or " +
  "capital gains. If you pay Income Tax at the higher or additional rate and want " +
  "to receive the additional tax relief due to you, you must include all your Gift " +
  "Aid donations on your Self-Assessment tax return or ask HMRC to adjust your tax code.";

export function poundsFromPence(pence) {
  return `£${(pence / 100).toFixed(2)}`;
}

// Normalise a UK postcode to HMRC's required form: capitals with a single space,
// e.g. "s192bd" -> "S19 2BD".
export function normalisePostcode(raw) {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "");
  if (s.length < 5) return s; // leave clearly-partial input as typed
  return `${s.slice(0, s.length - 3)} ${s.slice(s.length - 3)}`;
}

// Validate a donor submission. Returns { ok, errors, value }.
export function validateDeclaration(body) {
  const errors = [];
  const str = (v) => String(v ?? "").trim();

  const title = str(body.title).slice(0, 4);
  const firstName = str(body.firstName).slice(0, 35);
  const lastName = str(body.lastName).slice(0, 35);
  const houseNameOrNumber = str(body.houseNameOrNumber).slice(0, 35);
  const addressLine = str(body.addressLine).slice(0, 120);
  const postcode = normalisePostcode(body.postcode);
  const email = str(body.email).slice(0, 254);
  const scope = body.scope === "enduring" ? "enduring" : "single";
  const taxpayerConfirmed = body.taxpayerConfirmed === true || body.taxpayerConfirmed === "true";

  if (!firstName) errors.push("First name is required.");
  if (!lastName) errors.push("Last name is required.");
  if (!houseNameOrNumber) errors.push("House name or number is required.");
  if (!/^[A-Z0-9]{2,4}\s[A-Z0-9]{3}$/.test(postcode)) errors.push("A valid UK postcode is required.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email address looks invalid.");
  if (!taxpayerConfirmed) errors.push("You must confirm the UK taxpayer declaration.");

  return {
    ok: errors.length === 0,
    errors,
    value: {
      title,
      firstName,
      lastName,
      houseNameOrNumber,
      addressLine,
      postcode,
      email,
      scope,
      taxpayerConfirmed: true,
      declarationVersion: DECLARATION_VERSION,
    },
  };
}

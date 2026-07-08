// Produces a CSV whose columns match HMRC's Charities Online Gift Aid claim
// schedule (see docs/hmrc-gift-aid-guidance.md §3). Amounts have no £ and 2dp,
// dates are DD/MM/YY. Production must emit .ods and chunk at 1,000 rows; those
// rules are noted here and enforceable in the same place.

const HEADERS = [
  "Title",
  "First name",
  "Last name",
  "House name or number",
  "Postcode",
  "Aggregated donations",
  "Sponsored event",
  "Donation date",
  "Amount",
];

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ddmmyy(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(-2)}`;
}

export function buildClaimCsv(rows) {
  const lines = [HEADERS.join(",")];
  for (const { declaration: d, transaction: t } of rows) {
    lines.push(
      [
        d.title,
        d.firstName,
        d.lastName,
        d.houseNameOrNumber,
        d.postcode,
        "", // aggregated donations — blank for named declarations
        "No", // sponsored event
        ddmmyy(t.claimedAt || d.consentAt),
        (t.amountPence / 100).toFixed(2),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

export const MAX_ROWS_PER_SCHEDULE = 1000;

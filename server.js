// Zero-dependency Node HTTP server for the Gift Aid POC.
// Views: volunteer/iPad (create + QR + live confirm), donor form (autofill +
// localStorage prefill), admin (list + CSV export).

import { createServer } from "node:http";
import { config, GIFT_AID_RATE, retentionNote } from "./config.js";
import { toSVG } from "./lib/qr.js";
import * as store from "./lib/store.js";
import { sendReceipt } from "./lib/email.js";
import { buildClaimCsv } from "./lib/csv.js";
import * as decl from "./lib/declaration.js";

const now = () => Date.now();
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
  res.end(body);
}
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8" });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const ct = req.headers["content-type"] || "";
      if (ct.includes("application/json")) {
        try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
      } else {
        resolve(Object.fromEntries(new URLSearchParams(data)));
      }
    });
  });
}

function baseUrl(req) {
  if (config.baseUrl) return config.baseUrl.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${req.headers.host}`;
}

// --- Shared page shell ---
function page(title, body, extraHead = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>${esc(title)}</title>
<style>
:root{--brand:#7a1f2b;--ink:#1a1a1a;--muted:#666;--bg:#faf7f2;--ok:#1c7c3c}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{max-width:560px;margin:0 auto;padding:24px}
h1{color:var(--brand);font-size:1.5rem;margin:.2em 0}
h2{font-size:1.1rem;margin:1.2em 0 .4em}
label{display:block;font-weight:600;margin:.7em 0 .2em}
input[type=text],input[type=email],input[type=number]{width:100%;padding:12px;font-size:1.05rem;border:1px solid #ccc;border-radius:10px}
button{background:var(--brand);color:#fff;border:0;border-radius:10px;padding:14px 20px;font-size:1.05rem;font-weight:600;cursor:pointer;width:100%}
button.secondary{background:#fff;color:var(--brand);border:1px solid var(--brand)}
.card{background:#fff;border:1px solid #eee;border-radius:14px;padding:20px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.amount{font-size:2rem;font-weight:700;color:var(--brand)}
.muted{color:var(--muted);font-size:.9rem}
.check{display:flex;gap:10px;align-items:flex-start;margin:1em 0}
.check input{margin-top:4px;width:22px;height:22px;flex:0 0 auto}
.ok{color:var(--ok);font-weight:700}
.qr{text-align:center}.qr svg{width:min(78vw,320px);height:auto}
.err{background:#fde8e8;color:#8a1c1c;padding:10px 14px;border-radius:10px;margin:10px 0}
.banner{background:#eef6ef;border:1px solid #cfe8d4;padding:12px 14px;border-radius:10px;margin:12px 0}
a{color:var(--brand)}
table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
</style>${extraHead}</head><body><div class="wrap">${body}</div></body></html>`;
}

// --- Volunteer / iPad view ---
function volunteerView() {
  const body = `
<h1>${esc(config.charityName)}</h1>
<p class="muted">Gift Aid station — volunteer view</p>
<div class="card">
  <label for="amt">Donation amount (£)</label>
  <input id="amt" type="number" inputmode="decimal" min="1" step="0.01" placeholder="e.g. 51.00" autofocus>
  <p class="muted">Enter the amount charged on the SumUp machine, then tap below.</p>
  <button id="go">Create Gift Aid QR</button>
</div>
<div id="out"></div>
<script>
const out = document.getElementById('out');
document.getElementById('go').onclick = async () => {
  const pounds = parseFloat(document.getElementById('amt').value);
  if(!(pounds > 0)){ out.innerHTML = '<div class="err">Enter a valid amount.</div>'; return; }
  out.innerHTML = '<p class="muted">Creating…</p>';
  const r = await fetch('/api/transactions', {method:'POST',headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ amountPence: Math.round(pounds*100) })});
  const t = await r.json();
  out.innerHTML = '<div class="card qr"><h2>Scan to Gift Aid ' + t.amountText + '</h2>' + t.qrSvg +
    '<p class="muted">Ask the donor to scan with their phone camera.</p>' +
    '<p id="status" class="muted">Waiting for donor…</p>' +
    '<p class="muted">Link: <a href="'+t.donorUrl+'" target="_blank">'+t.donorUrl+'</a></p></div>';
  const poll = setInterval(async () => {
    const s = await (await fetch('/api/transactions/'+t.id+'/status')).json();
    if(s.status === 'claimed'){ clearInterval(poll);
      document.getElementById('status').outerHTML =
        '<p class="ok">✓ Declaration received — thank you!</p>'; }
    if(s.status === 'expired'){ clearInterval(poll);
      document.getElementById('status').outerHTML = '<p class="err">QR expired. Create a new one.</p>'; }
  }, 2000);
};
</script>`;
  return page(config.charityName + " — Gift Aid station", body);
}

// --- Donor form view ---
function donorView(txn, req) {
  const amountText = decl.poundsFromPence(txn.amountPence);
  const giftAid = decl.poundsFromPence(Math.round(txn.amountPence * GIFT_AID_RATE));
  const body = `
<h1>Gift Aid your donation</h1>
<div class="card">
  <p class="muted">Your donation to ${esc(txn.charityName)}</p>
  <div class="amount">${amountText}</div>
  <p class="muted">Gift Aid adds <strong>${giftAid}</strong> at no cost to you.</p>
</div>
<div id="welcome"></div>
<form id="f" class="card" autocomplete="on">
  <div class="banner">${esc(decl.singleScopeLine(txn.charityName, amountText))}</div>
  <div class="row2">
    <div><label for="title">Title</label>
      <input id="title" name="title" type="text" autocomplete="honorific-prefix" placeholder="Mr / Mrs / Rev"></div>
    <div><label for="firstName">First name</label>
      <input id="firstName" name="firstName" type="text" autocomplete="given-name" required></div>
  </div>
  <label for="lastName">Last name</label>
  <input id="lastName" name="lastName" type="text" autocomplete="family-name" required>
  <label for="houseNameOrNumber">House name or number</label>
  <input id="houseNameOrNumber" name="houseNameOrNumber" type="text" autocomplete="address-line1" required>
  <label for="addressLine">Rest of address (optional)</label>
  <input id="addressLine" name="addressLine" type="text" autocomplete="address-line2">
  <label for="postcode">Postcode</label>
  <input id="postcode" name="postcode" type="text" autocomplete="postal-code" autocapitalize="characters" required>
  <label for="email">Email for a receipt (optional)</label>
  <input id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com">
  <div class="check">
    <input id="tax" name="taxpayerConfirmed" type="checkbox" required>
    <label for="tax" style="font-weight:400;margin:0">${esc(decl.TAXPAYER_STATEMENT)}</label>
  </div>
  <button type="submit">Confirm my Gift Aid declaration</button>
  <p class="muted" style="margin-top:14px">${esc(decl.DECLARATION_FOOTER)}</p>
</form>
<div id="done"></div>
<script>
const PROFILE_KEY = 'giftaid_profile';
const f = document.getElementById('f');
const welcome = document.getElementById('welcome');
const fields = ['title','firstName','lastName','houseNameOrNumber','addressLine','postcode','email'];

// Returning-donor prefill from this phone only.
try {
  const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  if (p && p.firstName) {
    fields.forEach(k => { if (p[k] != null) document.getElementById(k).value = p[k]; });
    const ageDays = p.savedAt ? (Date.now()-p.savedAt)/86400000 : 999;
    welcome.innerHTML = '<div class="banner">Welcome back, '+ (p.firstName||'') +
      '. We\\'ve filled in your details — just confirm below.'+
      ' <a href="#" id="notme">Not you?</a></div>';
    document.getElementById('notme').onclick = (e)=>{e.preventDefault();
      localStorage.removeItem(PROFILE_KEY); location.reload();};
    // reconfirm taxpayer status if older than ~2 years
    if (ageDays < 730) { /* still valid; donor just ticks + submits */ }
  }
} catch(e){}

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {}; fields.forEach(k => body[k] = document.getElementById(k).value);
  body.taxpayerConfirmed = document.getElementById('tax').checked;
  body.scope = 'single';
  const r = await fetch(location.pathname + '/declaration',
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const res = await r.json();
  if (!r.ok) { alert((res.errors||['Something went wrong']).join('\\n')); return; }
  // save profile on this device for next time
  const profile = {}; fields.forEach(k => profile[k] = body[k]);
  profile.savedAt = Date.now();
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch(e){}
  f.style.display='none'; welcome.innerHTML='';
  document.getElementById('done').innerHTML =
    '<div class="card"><p class="ok">✓ Thank you, '+ (body.firstName||'') +
    '!</p><p>Your Gift Aid declaration for '+ ${JSON.stringify(amountText)} +
    ' has been recorded.'+ (body.email ? ' A receipt is on its way to '+body.email+'.' : '') +
    '</p></div>';
});
</script>`;
  return page("Gift Aid — " + config.charityName, body);
}

function expiredView() {
  return page("Link expired", `<h1>Link expired</h1>
<div class="card"><p>This donation link has expired or is invalid. Please ask a volunteer to create a new one.</p></div>`);
}

// --- Admin view ---
function adminView(rows, secret) {
  const totalPence = rows.reduce((s, r) => s + r.transaction.amountPence, 0);
  const giftAid = decl.poundsFromPence(Math.round(totalPence * GIFT_AID_RATE));
  const trs = rows
    .map(({ declaration: d, transaction: t }) => `<tr>
      <td>${esc(d.title)} ${esc(d.firstName)} ${esc(d.lastName)}</td>
      <td>${esc(d.houseNameOrNumber)}, ${esc(d.postcode)}</td>
      <td>${decl.poundsFromPence(t.amountPence)}</td>
      <td>${d.email ? "✓" : "—"}</td></tr>`)
    .join("");
  const body = `
<h1>${esc(config.charityName)}</h1>
<p class="muted">Admin — ${rows.length} declaration(s). ${esc(retentionNote())}</p>
<div class="card">
  <p>Total donations: <strong>${decl.poundsFromPence(totalPence)}</strong><br>
  Gift Aid to reclaim: <strong>${giftAid}</strong></p>
  <a href="/admin/export.csv?secret=${encodeURIComponent(secret)}"><button>Download CSV for HMRC</button></a>
</div>
<div class="card"><table><thead><tr><th>Name</th><th>Address</th><th>Amount</th><th>Receipt</th></tr></thead>
<tbody>${trs || '<tr><td colspan="4" class="muted">No declarations yet.</td></tr>'}</tbody></table></div>`;
  return page("Admin — " + config.charityName, body);
}

// --- Client / kiosk view: a standing scannable QR that forwards to the donor
// form, with live confirmation and a link to the results page. ---
function clientView(txn, donorUrl) {
  const amountText = decl.poundsFromPence(txn.amountPence);
  const body = `
<h1>${esc(config.charityName)}</h1>
<p class="muted">Scan to donate & Gift Aid</p>
<div class="card qr">
  <h2>Gift Aid ${amountText}</h2>
  ${toSVG(donorUrl, { scale: 6 })}
  <p class="muted">Point your phone camera at the code — it opens the form on your phone.</p>
  <p id="status" class="muted">Waiting for donor…</p>
  <p class="muted">Or open: <a href="${esc(donorUrl)}">${esc(donorUrl)}</a></p>
</div>
<div class="card">
  <a href="/results"><button class="secondary">View results</button></a>
  <p class="muted" style="margin-top:12px">Refresh this page for a new donation QR.</p>
</div>
<script>
const poll = setInterval(async () => {
  const s = await (await fetch('/api/transactions/${txn.id}/status')).json();
  if (s.status === 'claimed') { clearInterval(poll);
    document.getElementById('status').outerHTML =
      '<p class="ok">✓ Declaration received — <a href="/results">see results</a></p>'; }
  if (s.status === 'expired') { clearInterval(poll);
    document.getElementById('status').outerHTML =
      '<p class="err">This QR expired. Refresh for a new one.</p>'; }
}, 2000);
</script>`;
  return page(config.charityName + " — Scan to Gift Aid", body);
}

// --- Results view: reduced-PII public summary of tracked donations. Full detail
// and the HMRC CSV stay behind /admin?secret=. ---
function resultsView(rows) {
  const totalPence = rows.reduce((s, r) => s + r.transaction.amountPence, 0);
  const giftAid = decl.poundsFromPence(Math.round(totalPence * GIFT_AID_RATE));
  const trs = rows
    .slice()
    .reverse()
    .map(({ declaration: d, transaction: t }) => `<tr>
      <td>${esc(d.firstName)} ${esc((d.lastName || "").charAt(0))}.</td>
      <td>${decl.poundsFromPence(t.amountPence)}</td>
      <td>${decl.poundsFromPence(Math.round(t.amountPence * GIFT_AID_RATE))}</td>
      <td>${d.receiptSentAt ? "✓ sent" : d.email ? "queued" : "—"}</td></tr>`)
    .join("");
  const body = `
<h1>${esc(config.charityName)}</h1>
<p class="muted">Results — ${rows.length} Gift Aid declaration(s) tracked</p>
<div class="card">
  <p>Total donations: <span class="amount">${decl.poundsFromPence(totalPence)}</span><br>
  Gift Aid to reclaim from HMRC: <strong>${giftAid}</strong></p>
</div>
<div class="card"><table>
  <thead><tr><th>Donor</th><th>Amount</th><th>Gift Aid</th><th>Receipt</th></tr></thead>
  <tbody>${trs || '<tr><td colspan="4" class="muted">No declarations yet — scan a QR to add one.</td></tr>'}</tbody>
</table></div>
<div class="card"><a href="/client"><button class="secondary">Back to scan page</button></a></div>`;
  return page("Results — " + config.charityName, body);
}

// --- Router ---
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (req.method === "GET" && path === "/") return send(res, 200, volunteerView());

    // Standing scannable QR that forwards to the donor form. Optional ?amount=.
    if (req.method === "GET" && path === "/client") {
      const amt = parseFloat(url.searchParams.get("amount"));
      const amountPence = Number.isFinite(amt) && amt > 0 ? Math.round(amt * 100) : 1100;
      const txn = store.createTransaction(
        { amountPence, charityName: config.charityName },
        config.transactionTtlMinutes,
        now()
      );
      return send(res, 200, clientView(txn, `${baseUrl(req)}/d/${txn.id}`));
    }

    if (req.method === "GET" && path === "/results")
      return send(res, 200, resultsView(store.listClaimed()));

    if (req.method === "POST" && path === "/api/transactions") {
      const body = await readBody(req);
      const amountPence = Math.round(Number(body.amountPence));
      if (!Number.isFinite(amountPence) || amountPence <= 0 || amountPence > 1_000_000)
        return json(res, 400, { error: "invalid amount" });
      const txn = store.createTransaction(
        { amountPence, charityName: config.charityName },
        config.transactionTtlMinutes,
        now()
      );
      const donorUrl = `${baseUrl(req)}/d/${txn.id}`;
      return json(res, 201, {
        id: txn.id,
        amountText: decl.poundsFromPence(amountPence),
        donorUrl,
        qrSvg: toSVG(donorUrl, { scale: 6 }),
      });
    }

    let m;
    if ((m = path.match(/^\/d\/([\w-]+)$/)) && req.method === "GET") {
      const txn = store.getTransaction(m[1]);
      if (!txn) return send(res, 404, expiredView());
      const status = store.transactionStatus(txn, now());
      if (status === "expired") return send(res, 410, expiredView());
      if (status === "claimed")
        return send(res, 200, page("Already recorded",
          `<h1>Already recorded</h1><div class="card"><p class="ok">✓ This donation's Gift Aid declaration has already been completed. Thank you!</p></div>`));
      return send(res, 200, donorView(txn, req));
    }

    if ((m = path.match(/^\/api\/transactions\/([\w-]+)\/status$/)) && req.method === "GET") {
      const txn = store.getTransaction(m[1]);
      if (!txn) return json(res, 404, { status: "unknown" });
      return json(res, 200, { status: store.transactionStatus(txn, now()) });
    }

    if ((m = path.match(/^\/api\/transactions\/([\w-]+)$/)) && req.method === "GET") {
      const txn = store.getTransaction(m[1]);
      if (!txn) return json(res, 404, { error: "unknown" });
      return json(res, 200, {
        amountPence: txn.amountPence,
        charityName: txn.charityName,
        status: store.transactionStatus(txn, now()),
      });
    }

    if ((m = path.match(/^\/d\/([\w-]+)\/declaration$/)) && req.method === "POST") {
      const txn = store.getTransaction(m[1]);
      if (!txn) return json(res, 404, { errors: ["Unknown donation link."] });
      if (store.transactionStatus(txn, now()) === "expired")
        return json(res, 410, { errors: ["This donation link has expired."] });
      const body = await readBody(req);
      const v = decl.validateDeclaration(body);
      if (!v.ok) return json(res, 400, { errors: v.errors });
      // amount is NEVER taken from the donor — it comes from the stored txn.
      const { declaration, created } = store.addDeclaration(txn.id, v.value, now());
      if (created && declaration.email) {
        sendReceipt({
          to: declaration.email,
          charityName: txn.charityName,
          amountPence: txn.amountPence,
          dateStr: new Date(now()).toLocaleDateString("en-GB"),
          firstName: declaration.firstName,
        })
          .then((r) => { if (r.sent) store.markReceiptSent(declaration.id, now()); })
          .catch((err) => console.error("receipt failed:", err.message));
      }
      return json(res, created ? 201 : 200, { ok: true });
    }

    if (req.method === "GET" && (path === "/admin" || path === "/admin/export.csv")) {
      const secret = url.searchParams.get("secret") || "";
      if (secret !== config.adminSecret) return send(res, 401, page("Unauthorized",
        `<h1>Unauthorized</h1><div class="card"><p>Add <code>?secret=…</code> to the URL.</p></div>`));
      const rows = store.listClaimed();
      if (path === "/admin") return send(res, 200, adminView(rows, secret));
      return send(res, 200, buildClaimCsv(rows), {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="gift-aid-claim.csv"',
      });
    }

    return send(res, 404, page("Not found", `<h1>Not found</h1>`));
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: "server error" });
  }
});

server.listen(config.port, () => {
  console.log(`Gift Aid POC running on http://localhost:${config.port}`);
  console.log(`  Volunteer/iPad: /   |   Admin: /admin?secret=${config.adminSecret}`);
  console.log(`  Charity: ${config.charityName} (${config.charityType})  Email: ${config.email.provider}`);
});

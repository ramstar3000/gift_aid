# Gift Aid POC

QR-driven Gift Aid declarations for a UK temple. A volunteer sets the donation
amount (tied to a SumUp charge) on an iPad; the donor scans a QR code and fills
the declaration on their own phone with autofill; the iPad confirms live; the
donor gets an emailed receipt; returning donors are recognised on their own
device for a one-tap repeat. The **amount is set by the temple, never the donor**
— that's what makes it un-fakeable.

**Zero runtime npm dependencies** — runs on Node.js built-ins only. The QR
encoder is vendored in `lib/qr.js`.

## Run

```bash
node server.js
# open http://localhost:3000
```

No install step, no packages. Requires Node 20+ (developed on Node 24).

- **Volunteer / iPad:** `http://localhost:3000/`
- **Donor form:** opened by scanning the QR (a `/d/<id>` link)
- **Admin + CSV export:** `http://localhost:3000/admin?secret=temple-admin`

Data is stored in `data/db.json` (git-ignored). Delete it to reset a demo.

## Demo flow

1. On the iPad view, enter an amount (e.g. `51.00`) → **Create Gift Aid QR**.
2. Scan the QR with a phone → the Gift Aid form opens showing the amount
   **read-only**. Fill name/address (phone autofill helps), tick the UK-taxpayer
   box, optionally add an email, submit.
3. The iPad flips to **“✓ Declaration received”** within ~2 seconds.
4. Scan a new QR on the same phone → **“Welcome back”** with details pre-filled.
5. Open `/admin?secret=…` → **Download CSV for HMRC** (Charities Online columns).

## Configuration

All via environment variables (see `config.js`). Common ones:

| Variable | Default | Purpose |
|---|---|---|
| `CHARITY_NAME` | Shri Example Temple Trust | Name on declaration/receipt/export |
| `CHARITY_TYPE` | `trust` | `trust` or `company` (retention wording) |
| `PORT` | `3000` | Server port |
| `BASE_URL` | (request host) | Public URL used to build QR links |
| `ADMIN_SECRET` | `temple-admin` | Guards `/admin` |
| `EMAIL_PROVIDER` | `none` | `none` (logs), `resend`, or `gmail` |
| `RESEND_API_KEY` | — | For `EMAIL_PROVIDER=resend` |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | — | For `EMAIL_PROVIDER=gmail` |

With `EMAIL_PROVIDER=none` the receipt is printed to the server log, so the demo
needs no email setup.

## What's real vs. stubbed for the POC

- **Real:** server-authoritative amounts, unguessable single-use transaction IDs,
  idempotent declarations, immutable audit records, autofill, localStorage
  returning-donor recall, HMRC-shaped CSV export, self-generated QR codes.
- **Stubbed:** the SumUp card-charge match (a `sumupChargeRef` hook exists on each
  transaction); storage is a JSON file (swap `lib/store.js` for Postgres in prod);
  CSV instead of the `.ods` HMRC upload format.

## Compliance reference

See [`docs/hmrc-gift-aid-guidance.md`](docs/hmrc-gift-aid-guidance.md) for the
declaration wording, claim-schedule columns and retention rules, with sources.
Full plan in [`PLAN.md`](PLAN.md).

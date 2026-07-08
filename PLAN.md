# Gift Aid Automation — POC Plan

## Context

A UK temple takes donations at a giving point. Today a volunteer **types each donor's
Gift Aid declaration by hand on an iPad** — slow, error-prone, and hard to audit. This POC
automates it: a volunteer sets the amount (tied to a **SumUp** card charge), the app shows a
**QR code**, the donor scans it with their **own phone**, their details **auto-fill**, they tick
the UK-taxpayer declaration, and the iPad confirms — with an **emailed receipt** and a one-tap
path for returning donors. Goal: **demonstrate the utility to non-technical trustees.**

The anti-fraud spine: **the donor never sets the amount.** The temple sets it; the donor's phone
only reads it. See the threat model.

Compliance details (declaration wording, claim CSV columns, retention) live in
[`docs/hmrc-gift-aid-guidance.md`](docs/hmrc-gift-aid-guidance.md).

## Constraints (from the user)

- **Amount:** entered on the iPad, linked to a SumUp charge — never entered by the donor.
- **Returning donors:** remembered with **client-side cookies / localStorage** on the donor's
  own phone (no server-side donor login).
- **Receipts:** email a receipt to donors so they can track their Gift Aid.
- **Demo:** deploy simply (Vercel); production would live on the temple's own website.
- **Dependencies:** **no random npm packages.** Prefer the platform (Node/web built-ins) and a
  tiny number of well-established, single-purpose libraries only where hand-rolling is unreasonable.
- Repo: `git@github.com:ramstar3000/gift_aid.git`.

## The flow

1. Volunteer enters amount on the iPad → app creates a **transaction** (unguessable id,
   server-authoritative amount) → shows a **QR code** ("Waiting for donor…").
2. Donor scans QR → mobile web Gift Aid form opens, **amount shown read-only**, HMRC wording.
3. Donor fills name/address via **phone autofill** (or one-tap from a prior visit), ticks the
   UK-taxpayer box, optionally enters email, submits.
4. Server stores the **immutable declaration** bound to that transaction; iPad flips to
   **"Declaration received"** (via ~2s polling).
5. Donor gets an **emailed receipt**; the donor's phone saves their profile locally for next time.
6. Trustee/admin screen lists declarations and offers **"Download CSV for HMRC"** (exact
   Charities Online columns).

## Tech stack (minimal, no random packages)

- **Next.js (App Router) on Vercel** — serverless API routes + SSR + free HTTPS.
  (HTTPS matters for phone camera QR scanning and autofill.) GitHub Pages is rejected: it's
  static-only and cannot hold a tamper-proof server-side amount.
- **Storage: Vercel Postgres / Neon** — relational, maps 1:1 to the HMRC export and the
  append-only audit record.
- **IDs:** Node built-in `crypto.randomUUID()` — no package.
- **QR code:** rendered as **SVG we generate ourselves** (a QR encoder is one small, well-scoped
  dependency if hand-rolling proves unreasonable — decide at build time; do **not** call an
  external QR image service, which would leak the URL).
- **Email receipts:** send via a provider's **HTTP API using `fetch`** (no SDK package), or SMTP.
  Provider TBD with the user (see open questions). Keep the API key in an env var.
- **Validation:** hand-written checks or one small schema lib — avoid pulling a large tree.
- **Styling:** minimal CSS / a single utility layer; mobile-first. Keep it dependency-light.

## Data model (Postgres)

**transactions** — `id` (random UUID, unguessable), `amount_pence` (int, server-set),
`charity_name`, `status` (`pending`→`claimed`→`expired`), `created_at`, `expires_at`,
`claimed_at`, `sumup_charge_ref` (nullable, future reconciliation hook).

**declarations** (append-only, immutable) — `id`, `transaction_id` (FK), `title`, `first_name`,
`last_name`, `house_name_or_number`, `address_line`, `postcode`, `scope` (`single`|`enduring`),
`taxpayer_confirmed` (bool), `email` (nullable), `declaration_text_version`, `consent_at`,
`receipt_sent_at` (nullable).

Never hard-delete — this is the 6-year HMRC audit record.

## API endpoints (Next.js route handlers)

- `POST /api/transactions` — iPad creates a transaction. Body `{ amountPence }`.
  Returns `{ id, donorUrl, qrSvg }`. **Amount authoritative here.**
- `GET /api/transactions/:id` — donor form reads `{ amountPence, charityName, status }`.
- `GET /api/transactions/:id/status` — iPad polls; returns `{ status }` only.
- `POST /api/transactions/:id/declaration` — donor submits. Validates transaction is
  `pending` + unexpired; writes immutable declaration; flips status; **idempotent**; amount
  comes from the store, never the body. Triggers the receipt email if an address was given.
- `GET /api/export` — admin CSV in exact HMRC column order (DD/MM/YY dates, 2dp amounts,
  1,000-row chunking). Protect with a shared secret for the demo.

## Autofill + returning-donor prefill

- Use standard `autocomplete` tokens so iOS/Android offer the saved address card:
  `honorific-prefix`, `given-name`, `family-name`, `address-line1`, `address-level2`,
  `postal-code`, `email`. Real `<form>` + `<label for>` associations; serve over HTTPS.
- On submit, save the donor profile to **localStorage** on their own phone. Next visit: pre-fill
  every field and show "Welcome back — just confirm." If the prior declaration was **enduring**
  and < 24 months old, offer **one-tap confirm**. Provide a "Not you? / clear" control (shared
  phones, GDPR erasure). The server record is always written fresh; localStorage is UX only.

## Email receipts

- After a successful declaration with an email, send a receipt: charity name, amount, date,
  a note that Gift Aid (25%) will be reclaimed, a keep-for-your-records / higher-rate-relief
  reminder, and the change-of-circumstances notice from the declaration footer.
- Sent server-side from the declaration handler; record `receipt_sent_at`. Failure to email must
  **not** fail the declaration (retry/log instead).
- Email is optional for the donor; the declaration is valid without it.

## Threat model — "why donors can't lie"

- **Amount integrity:** donor's phone only reads the amount; `POST declaration` ignores any
  amount in the body and uses the stored value. Donor cannot inflate/deflate.
- **Unguessable single-use IDs:** 128-bit random ids; one declaration per transaction
  (idempotent); short TTL so stale QR codes can't be reused.
- **Consent evidence:** store the exact declaration wording/version, the ticked confirmation, a
  server `consent_at`, and the immutable link to the transaction — the HMRC audit trail.
- **Future SumUp reconciliation:** `sumup_charge_ref` hook — in production, match each transaction
  to a settled SumUp charge of the same amount via webhook/API before marking it verified.
- **Residual (be honest to trustees):** the system can't verify the donor really is a UK taxpayer
  or that the name/address is truthful — that is the donor's legal responsibility everywhere.

## Demo script for trustees

1. **Problem** (20s): "Today volunteers hand-type every declaration. Here it's automated — and the
   donor can never change the amount."
2. Volunteer enters £51 on the iPad → **QR appears**, "Waiting for donor…".
3. Donor scans → form shows **"Your donation: £51.00" (read-only)** + HMRC wording.
4. Tap name → **autofill** fills name + address + postcode; tick taxpayer box; enter email; submit.
5. iPad flips to green **"Declaration received"** in ~2s. Donor gets an **emailed receipt**.
6. **Returning-donor highlight:** new amount → new QR → same phone → "Welcome back — just confirm"
   → **one tap**, done.
7. **"Download CSV for HMRC"** → open it → columns already match HMRC's schedule. "This currently
   takes hours each quarter."
8. Close: immutable 6-year audit record; SumUp small contactless gifts can also be claimed via
   GASDS later — extra money, same system.

## Risks / edge cases

- Autofill varies across iOS/Android and empty address cards → correct tokens + graceful manual entry.
- HTTPS + camera needed for QR scanning → Vercel HTTPS; test venue WiFi/captive portals.
- No-JS: render amount + accept a plain form POST so the legal path doesn't depend on JS.
- Duplicate submissions → idempotent declaration endpoint.
- Abandoned form → transaction TTL + volunteer cancel/retry; excluded from export.
- GDPR/PII (names, addresses, emails): privacy notice on the form, encryption at rest, access
  control on export, 6-year retention then deletion, "forget me" for localStorage.
- Shared/loaner phone → disable localStorage prefill on flagged shared devices.
- Postcode normalisation (capitals + space) on submit and export.
- Export: separate rows per accounting period; chunk at 1,000 rows; `.ods` for production.

## Open questions

- **Email provider** for receipts (e.g. a transactional email API via `fetch`, or SMTP)?
- Charity constituted as a **company or a trust** (affects retention calc)?
- Fixed **charity name** and giving-point wording to hard-code for the POC?

## Verification (once built)

- Create a transaction on the iPad view; confirm the amount is server-stored and read-only on the phone.
- Submit a declaration; confirm the iPad polls to "received", a receipt email arrives, and the row is immutable.
- Re-scan on the same phone; confirm one-tap prefill works and a second declaration is recorded correctly.
- Attempt to tamper the amount via the API body; confirm the stored amount wins.
- Download the CSV; diff columns/format against `docs/hmrc-gift-aid-guidance.md` §3.

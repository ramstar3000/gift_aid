# HMRC Gift Aid — Guidance Reference

> Working reference for building the Gift Aid automation app. Everything here is drawn
> from HMRC / GOV.UK guidance and UK legislation, with source links. **Re-check the live
> pages before a production build** — HMRC updates the templates and the claim schedule
> periodically. Sources are listed at the bottom.

---

## 1. What makes a Gift Aid declaration valid

A valid declaration **must** contain all of the following ([GOV.UK — Gift Aid declarations](https://www.gov.uk/guidance/gift-aid-declarations-claiming-tax-back-on-donations)):

- The name of the charity (or CASC).
- The donor's **full name** (at minimum first initial(s) + surname).
- The donor's **home address** (at minimum house name/number + postcode).
- Whether the declaration covers a **single donation** or **past / present / future** donations.
- A statement that the donor **wants Gift Aid to apply**.
- The **UK taxpayer understanding statement** (see below) — or evidence the charity explained it.

The charity must be able to show HMRC that the donor was told they must
*"pay the same amount or more of UK Income Tax and/or Capital Gains Tax as all charities
and CASCs will claim on the donor's gifts in a tax year, and that the donor is responsible
to pay any difference."*

---

## 2. Canonical declaration wording (use verbatim)

Taken from HMRC's own single-donation template PDF
([GOV.UK — single donation declaration form](https://www.gov.uk/government/publications/charities-gift-aid-declaration-form-for-a-single-donation)).

**Header:**

> **Boost your donation by 25p of Gift Aid for every £1 you donate.**
> Gift Aid is reclaimed by the charity from the tax you pay for the current tax year.
> Your address is needed to identify you as a current UK taxpayer.

**Declaration line (single donation):**

> ☐ I want to Gift Aid my donation of £______ to **[Charity name]**.

**Declaration line (enduring / multi-year variant):**

> ☐ I want to Gift Aid any donations I make in the future or have made in the past
> 4 years to **[Charity name]**.

**UK taxpayer statement (the load-bearing legal sentence — do not paraphrase):**

> **I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains
> Tax in the current tax year than the amount of Gift Aid claimed on all my donations it
> is my responsibility to pay any difference.**

**Donor detail fields:** Title · First name or initial(s) · Surname · Full home address · Postcode · Date.

**Footer (part of a compliant declaration):**

> Please notify the charity if you: want to cancel this declaration; change your name or
> home address; no longer pay sufficient tax on your income and/or capital gains.
> If you pay Income Tax at the higher or additional rate and want to receive the additional
> tax relief due to you, you must include all your Gift Aid donations on your Self-Assessment
> tax return or ask HMRC to adjust your tax code.

> **App note:** store the exact wording/version string the donor agreed to, alongside the
> consent timestamp, as audit evidence that the statement was shown.

---

## 3. Charities Online claim schedule — donor CSV/ODS columns

The claim is filed via **Charities Online** using HMRC's schedule spreadsheet. Match these
columns exactly, in this order
([GOV.UK — schedule spreadsheet guidance](https://www.gov.uk/guidance/schedule-spreadsheet-to-claim-back-tax-on-gift-aid-donations)):

| Column | Rule |
|---|---|
| **Title** | Max 4 characters (Mr, Mrs, Rev…). Optional. |
| **First name** | Part of name; max 35 chars. |
| **Last name** | Max 35 chars; double-barrelled → use a space, not a hyphen. |
| **House name or number** | Just the house name/number, **not** the full address. |
| **Postcode** | Capital letters with a space, e.g. `S19 2BD`. |
| **Aggregated donations** | Description (max 35 chars) for pooled small gifts — used **instead of** name/address. Each gift ≤ £30, total ≤ £1,000 per line. Leave blank for named declarations. |
| **Sponsored event** | `Yes` / `No`. |
| **Donation date** | Format `DD/MM/YY`. For a series, the date of the **last** donation. |
| **Amount** | No `£` sign, 2 decimal places, e.g. `200.00`. |

**Hard limits:**
- Max **1,000 rows** per spreadsheet — chunk into multiple files beyond that.
- Donations in **different accounting periods** must go on **separate rows** (never merge across periods).
- Production upload must be **OpenDocument `.ods`**. (POC may export CSV with identical columns, then convert.)

---

## 4. Record keeping, retention & audit trail

From [Chapter 7: Audits by HMRC charities](https://www.gov.uk/government/publications/charities-detailed-guidance-notes/chapter-7-audits-by-hmrc-charities)
and [Gift Aid Declarations Regulations 2016, reg. 9](https://www.legislation.gov.uk/uksi/2016/1195/regulation/9/made):

- **Retention: 6 years.**
  - Company charity: 6 years after the end of the accounting period.
  - Trust charity: the later of 6 years after the end of the tax year, **or** 12 months after the claim.
  - Enduring declarations for ongoing donations: keep for as long as donations continue.
  - ⚠️ The **"4 years"** figure is the **claim deadline**, *not* the retention period — don't confuse them.
- **Audit trail:** each donation must be traceable → to a valid declaration → to the accounting
  record, with evidence the taxpayer statement was given. Store declarations **append-only /
  immutable** with a server timestamp.

> **App note:** confirm whether the temple is constituted as a **company** or a **trust** — it
> changes the exact retention calculation above.

---

## 5. GASDS — Gift Aid Small Donations Scheme (bonus, relevant to SumUp)

Because donations run through a **SumUp** card machine, contactless donations of **£30 or less**
can be claimed under **GASDS with no declaration required**, and card-terminal transaction
exports are accepted as evidence
([GOV.UK — GASDS](https://www.gov.uk/guidance/claiming-a-top-up-payment-on-small-charitable-donations)).

- Two capture paths in the app: (a) **named Gift Aid** (any amount, donor gives details);
  (b) **GASDS** on the small un-declared contactless remainder.
- Out of scope for the first POC, but leave a hook for it — it is effectively free additional income.

---

## 6. Receipts / donor communications (in scope)

Emailing receipts is **not** an HMRC requirement, but it is good practice and helps donors track
their Gift Aid for their own Self-Assessment (higher-rate relief). A receipt should include:

- Charity name, donation amount, date.
- A note that a Gift Aid declaration was made and 25% will be reclaimed (if applicable).
- A reminder to keep the receipt for their records / higher-rate tax relief.
- A link/instruction to notify the charity if they stop being a UK taxpayer or change address
  (mirrors the declaration footer obligation).

> **Compliance note:** collecting an email address adds PII — see GDPR notes in the main plan.
> Email is optional for the donor; the Gift Aid declaration is valid without it.

---

## Sources

- Gift Aid declarations: https://www.gov.uk/guidance/gift-aid-declarations-claiming-tax-back-on-donations
- Single-donation declaration template: https://www.gov.uk/government/publications/charities-gift-aid-declaration-form-for-a-single-donation
- Schedule spreadsheet guidance: https://www.gov.uk/guidance/schedule-spreadsheet-to-claim-back-tax-on-gift-aid-donations
- Schedule spreadsheet downloads: https://www.gov.uk/government/publications/gift-aid-schedule-spreadsheets-to-claim-back-tax-on-donations
- Claim tax back using Charities Online: https://www.gov.uk/guidance/claim-tax-back-on-donations-using-charities-online
- Chapter 7 — Audits by HMRC charities: https://www.gov.uk/government/publications/charities-detailed-guidance-notes/chapter-7-audits-by-hmrc-charities
- Gift Aid Declarations Regulations 2016, reg. 9: https://www.legislation.gov.uk/uksi/2016/1195/regulation/9/made
- GASDS top-up payments: https://www.gov.uk/guidance/claiming-a-top-up-payment-on-small-charitable-donations

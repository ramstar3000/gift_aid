// Central configuration. Override any value with an environment variable of the
// same name (see below) so nothing sensitive is hard-coded for production.

export const config = {
  // --- Charity identity (appears on the declaration, receipts and export) ---
  charityName: process.env.CHARITY_NAME || "Shri Example Temple Trust",

  // Legal form of the charity. Affects HMRC record-retention wording only.
  // "trust" | "company"  — changeable.
  charityType: process.env.CHARITY_TYPE || "trust",

  // Public base URL of the deployment (used to build the QR link). In dev this
  // is derived from the request host if left blank.
  baseUrl: process.env.BASE_URL || "",

  // --- Server ---
  port: Number(process.env.PORT || 3000),

  // How long a pending transaction / QR stays valid (minutes).
  transactionTtlMinutes: Number(process.env.TXN_TTL_MINUTES || 30),

  // Shared secret protecting the admin/export screen (demo-grade).
  adminSecret: process.env.ADMIN_SECRET || "temple-admin",

  // --- Email receipts ---
  email: {
    // "resend" | "gmail" | "none".  "none" logs the receipt instead of sending,
    // so the demo runs with no email setup at all.
    provider: process.env.EMAIL_PROVIDER || "none",
    fromAddress: process.env.EMAIL_FROM || "receipts@example-temple.org",
    fromName: process.env.EMAIL_FROM_NAME || "Shri Example Temple",
    // Resend: set EMAIL_PROVIDER=resend and RESEND_API_KEY.
    resendApiKey: process.env.RESEND_API_KEY || "",
    // Gmail: set EMAIL_PROVIDER=gmail, GMAIL_USER and GMAIL_APP_PASSWORD
    // (a Google "app password", not your normal password).
    gmailUser: process.env.GMAIL_USER || "",
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD || "",
  },
};

// Gift Aid is worth 25% of the donation (basic rate 20% grossed up).
export const GIFT_AID_RATE = 0.25;

// Retention guidance shown to admins, depends on charity type.
export function retentionNote(type = config.charityType) {
  return type === "company"
    ? "Records kept 6 years after the end of the accounting period."
    : "Records kept until the later of 6 years after the end of the tax year, or 12 months after the claim.";
}

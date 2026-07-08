// Receipt email. Uses provider HTTP APIs via the built-in `fetch` (no SDK).
// Provider "none" logs the receipt so the demo runs with no email setup.
// A failed send never blocks a declaration — the caller ignores rejections.

import { connect as tlsConnect } from "node:tls";
import { config, GIFT_AID_RATE } from "../config.js";
import { poundsFromPence } from "./declaration.js";

function receiptText({ charityName, amountPence, dateStr, firstName }) {
  const giftAid = poundsFromPence(Math.round(amountPence * GIFT_AID_RATE));
  return (
    `Dear ${firstName || "Donor"},\n\n` +
    `Thank you for your donation of ${poundsFromPence(amountPence)} to ${charityName} on ${dateStr}.\n\n` +
    `You made a Gift Aid declaration, so ${charityName} will reclaim ${giftAid} from HMRC ` +
    `at no extra cost to you.\n\n` +
    `Please keep this receipt for your records. If you pay Income Tax at the higher or ` +
    `additional rate you can claim extra relief on this donation via your Self-Assessment ` +
    `tax return. Please let us know if you stop being a UK taxpayer or change your name or address.\n\n` +
    `With thanks,\n${charityName}`
  );
}

export async function sendReceipt({ to, charityName, amountPence, dateStr, firstName }) {
  const subject = `Your donation receipt — ${charityName}`;
  const text = receiptText({ charityName, amountPence, dateStr, firstName });
  const provider = config.email.provider;

  if (!to || provider === "none") {
    console.log(`[receipt:${provider}] would send to ${to || "(no email)"}:\n${text}\n`);
    return { sent: false, reason: "logged" };
  }
  if (provider === "resend") return sendViaResend({ to, subject, text });
  if (provider === "gmail") return sendViaGmail({ to, subject, text });
  console.log(`[receipt] unknown provider "${provider}"`);
  return { sent: false, reason: "unknown-provider" };
}

async function sendViaResend({ to, subject, text }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${config.email.fromName} <${config.email.fromAddress}>`,
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
  return { sent: true, provider: "resend" };
}

// Minimal SMTP-over-TLS for Gmail (smtp.gmail.com:465) using an app password.
// Kept dependency-free; sufficient for a single transactional receipt.
function sendViaGmail({ to, subject, text }) {
  const { gmailUser, gmailAppPassword, fromName, fromAddress } = config.email;
  const b64 = (s) => Buffer.from(s).toString("base64");
  const message =
    `From: ${fromName} <${fromAddress}>\r\n` +
    `To: ${to}\r\nSubject: ${subject}\r\n` +
    `MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}`;

  const steps = [
    { expect: 220 },
    { send: `EHLO localhost`, expect: 250 },
    { send: `AUTH LOGIN`, expect: 334 },
    { send: b64(gmailUser), expect: 334 },
    { send: b64(gmailAppPassword), expect: 235 },
    { send: `MAIL FROM:<${fromAddress}>`, expect: 250 },
    { send: `RCPT TO:<${to}>`, expect: 250 },
    { send: `DATA`, expect: 354 },
    { send: `${message}\r\n.`, expect: 250 },
    { send: `QUIT`, expect: 221 },
  ];

  return new Promise((resolve, reject) => {
    const socket = tlsConnect(465, "smtp.gmail.com", { servername: "smtp.gmail.com" });
    let i = 0;
    let buf = "";
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error("SMTP timeout")); });
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      if (!buf.endsWith("\r\n")) return;
      const code = Number(buf.slice(0, 3));
      buf = "";
      if (code !== steps[i].expect) { socket.destroy(); return reject(new Error(`SMTP ${code}`)); }
      i++;
      if (i >= steps.length) { resolve({ sent: true, provider: "gmail" }); return; }
      if (steps[i].send !== undefined) socket.write(steps[i].send + "\r\n");
    });
  });
}

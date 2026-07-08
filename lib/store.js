// Tiny JSON-file-backed store. Chosen for a zero-dependency, inspectable,
// resettable POC (delete data/db.json to start fresh). Declarations are treated
// as append-only — the app never mutates or deletes them, matching the HMRC
// audit-trail requirement. For production this module is the seam to swap in
// Postgres without touching the rest of the app.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "data/db.json";

function load() {
  if (!existsSync(DB_PATH)) return { transactions: {}, declarations: {} };
  try {
    return JSON.parse(readFileSync(DB_PATH, "utf8"));
  } catch {
    return { transactions: {}, declarations: {} };
  }
}

function save(db) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = load();

export function createTransaction({ amountPence, charityName }, ttlMinutes, now) {
  const id = randomUUID();
  const txn = {
    id,
    amountPence, // server-authoritative — never taken from the donor
    charityName,
    status: "pending",
    createdAt: now,
    expiresAt: now + ttlMinutes * 60_000,
    claimedAt: null,
    sumupChargeRef: null, // reconciliation hook for production
  };
  db.transactions[id] = txn;
  save(db);
  return txn;
}

export function getTransaction(id) {
  return db.transactions[id] || null;
}

// Returns "pending" | "claimed" | "expired" (never mutates on read except to
// surface expiry).
export function transactionStatus(txn, now) {
  if (txn.status === "claimed") return "claimed";
  if (now > txn.expiresAt) return "expired";
  return "pending";
}

export function getDeclarationForTransaction(txnId) {
  return Object.values(db.declarations).find((d) => d.transactionId === txnId) || null;
}

// Idempotent: if a declaration already exists for the transaction, return it.
export function addDeclaration(txnId, fields, now) {
  const existing = getDeclarationForTransaction(txnId);
  if (existing) return { declaration: existing, created: false };

  const id = randomUUID();
  const declaration = {
    id,
    transactionId: txnId,
    ...fields,
    consentAt: now,
    receiptSentAt: null,
  };
  db.declarations[id] = declaration;
  db.transactions[txnId].status = "claimed";
  db.transactions[txnId].claimedAt = now;
  save(db);
  return { declaration, created: true };
}

export function markReceiptSent(declarationId, now) {
  if (db.declarations[declarationId]) {
    db.declarations[declarationId].receiptSentAt = now;
    save(db);
  }
}

// All claimed declarations joined with their transaction, for the admin/export.
export function listClaimed() {
  return Object.values(db.declarations)
    .map((d) => ({ declaration: d, transaction: db.transactions[d.transactionId] }))
    .filter((row) => row.transaction)
    .sort((a, b) => a.declaration.consentAt - b.declaration.consentAt);
}

// owner.js — owner-only UX gate.
//
// The owner's email is deliberately NOT stored here — only a SHA-256
// hash of it. At sign-in the app hashes the signed-in user's email and
// compares, so the literal address never appears in this (public) repo.
//
// IMPORTANT: this is a UX gate — it keeps the owner-only Database menu
// out of other users' UI — NOT a security boundary. Client code can be
// read and bypassed, and the underlying response data is readable by
// any signed-in user by Firestore-rules design. The hash only keeps the
// owner's email private in the repo; it does not lock anything down.

// SHA-256 of the owner's email (lower-cased, trimmed).
const OWNER_EMAIL_SHA256 =
  "3e6a4fc8af5a8eb53e311d39789dbdfd6f1ae044c624e8788cd030d33cdbd96a";

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Resolve whether the given Firebase user is the app owner — by hashing
 * their email and comparing to the stored digest. Async (Web Crypto;
 * needs a secure context — https or localhost, both of which apply).
 * Returns false for no user, no email, or any error.
 *
 * @param {?{email?:string}} user
 * @returns {Promise<boolean>}
 */
export async function isOwnerUser(user) {
  if (!user || !user.email) return false;
  try {
    const h = await sha256Hex(String(user.email).trim().toLowerCase());
    return h === OWNER_EMAIL_SHA256;
  } catch (_) {
    return false;
  }
}

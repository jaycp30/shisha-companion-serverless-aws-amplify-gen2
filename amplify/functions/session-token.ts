import { createHmac, timingSafeEqual } from 'node:crypto';

// Our own short-lived proof-of-humanness credential, shared by the functions that
// mint (mint-session-token) and verify (get-upload-url, chat) it.
//
// Why it exists: Turnstile tokens are single-use and minutes-lived, but a browsing
// session makes many protected calls — including PARALLEL presigns for a multi-page
// menu, which a single-use token cannot cover. So the client trades one Turnstile
// token for this reusable HMAC-signed token, and every protected Lambda verifies it
// LOCALLY (no Cloudflare round trip per request).
//
// Format: `v1.<expiresAt>.<hmac>` — expiry in epoch seconds, HMAC-SHA256 over
// `v1.<expiresAt>` with a shared secret. There is nothing per-user in it on purpose:
// it only attests "a Turnstile challenge was passed recently", the minimum needed.

const TOKEN_VERSION = 'v1';

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export interface MintedSessionToken {
  token: string;
  /** Epoch seconds — the client uses this to renew before expiry. */
  expiresAt: number;
}

/** Create a fresh token valid for `ttlSeconds` from now. */
export function createSessionToken(
  secret: string,
  ttlSeconds: number,
): MintedSessionToken {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${TOKEN_VERSION}.${expiresAt}`;
  return { token: `${payload}.${signPayload(payload, secret)}`, expiresAt };
}

/** True only for a well-formed, unexpired token carrying a valid signature. */
export function isValidSessionToken(
  token: string | null | undefined,
  secret: string,
): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false;

  const [version, expiresAtText, signature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  // Constant-time comparison so the signature can't be probed byte by byte.
  // timingSafeEqual throws on length mismatch, so guard that case first.
  const expected = signPayload(`${version}.${expiresAtText}`, secret);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

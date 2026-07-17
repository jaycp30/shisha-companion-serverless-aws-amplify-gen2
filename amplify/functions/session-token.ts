import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

// Our own short-lived proof-of-humanness + session-identity credential, shared by the
// functions that mint (mint-session-token) and verify (get-upload-url, chat,
// start-menu-analysis, get-menu-analysis-status) it.
//
// Why it exists: Turnstile tokens are single-use and minutes-lived, but a browsing
// session makes many protected calls — including PARALLEL presigns for a multi-page
// menu, which a single-use token cannot cover. So the client trades one Turnstile
// token for this reusable HMAC-signed token, and every protected Lambda verifies it
// LOCALLY (no Cloudflare round trip per request).
//
// Format: `v2.<sessionId>.<expiresAt>.<hmac>`
//   sessionId  — a SERVER-generated random id. The client never chooses it, so it is a
//                trustworthy ownership key: uploads land under menu/<sessionId>/, and a
//                menu job is readable only by the session that created it. It also acts
//                as a nonce, so two tokens minted in the same second differ.
//   expiresAt  — epoch seconds.
//   hmac       — HMAC-SHA256 over `v2.<sessionId>.<expiresAt>` with a shared secret.
//
// (v1 was `v2` minus the sessionId; changing the version invalidates old in-memory
// tokens on deploy, which is harmless — the client re-mints on the next call.)

const TOKEN_VERSION = 'v2';

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export interface MintedSessionToken {
  token: string;
  /** Epoch seconds — the client uses this to renew before expiry. */
  expiresAt: number;
}

/** Create a fresh token for a brand-new random session, valid for `ttlSeconds`. */
export function createSessionToken(
  secret: string,
  ttlSeconds: number,
): MintedSessionToken {
  const sessionId = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${TOKEN_VERSION}.${sessionId}.${expiresAt}`;
  return { token: `${payload}.${signPayload(payload, secret)}`, expiresAt };
}

export interface VerifiedSession {
  sessionId: string;
}

/**
 * Verify a token and return its session identity, or null if it is malformed, expired,
 * or has an invalid signature. This is the ONLY place a sessionId should come from —
 * anything the client sends directly is untrusted.
 */
export function readSessionToken(
  token: string | null | undefined,
  secret: string,
): VerifiedSession | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;

  const [version, sessionId, expiresAtText, signature] = parts;
  if (!sessionId) return null;

  const expiresAt = Number(expiresAtText);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  // Constant-time comparison so the signature can't be probed byte by byte.
  // timingSafeEqual throws on length mismatch, so guard that case first.
  const expected = signPayload(`${version}.${sessionId}.${expiresAtText}`, secret);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  return { sessionId };
}

/** True for a well-formed, unexpired, correctly-signed token. For callers that only
 *  need proof-of-humanness and don't care which session it is (e.g. chat). */
export function isValidSessionToken(
  token: string | null | undefined,
  secret: string,
): boolean {
  return readSessionToken(token, secret) !== null;
}

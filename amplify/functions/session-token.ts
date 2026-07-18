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
// Format: `v3.<scope>.<sessionId>.<expiresAt>.<hmac>`
//   scope      — 'full' for a token minted after a real Turnstile pass, or 'degraded'
//                for one minted while Cloudflare siteverify was unreachable (short-lived,
//                globally capped — see mint-session-token). The scope is INSIDE the signed
//                payload, so a client can't upgrade a degraded token to full.
//   sessionId  — a SERVER-generated random id. The client never chooses it, so it is a
//                trustworthy ownership key: uploads land under menu/<sessionId>/, and a
//                menu job is readable only by the session that created it. It also acts
//                as a nonce, so two tokens minted in the same second differ.
//   expiresAt  — epoch seconds.
//   hmac       — HMAC-SHA256 over `v3.<scope>.<sessionId>.<expiresAt>` with a shared secret.
//
// (Bumping the version invalidates old in-memory tokens on deploy, which is harmless —
// the client re-mints on the next call. v2 was this minus the scope claim.)

const TOKEN_VERSION = 'v3';

// A token's privilege level, baked into the signed payload.
export type SessionScope = 'full' | 'degraded';
const VALID_SCOPES: ReadonlySet<string> = new Set<SessionScope>(['full', 'degraded']);

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
  scope: SessionScope = 'full',
): MintedSessionToken {
  const sessionId = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${TOKEN_VERSION}.${scope}.${sessionId}.${expiresAt}`;
  return { token: `${payload}.${signPayload(payload, secret)}`, expiresAt };
}

export interface VerifiedSession {
  sessionId: string;
  scope: SessionScope;
}

/**
 * Verify a token and return its session identity + scope, or null if it is malformed,
 * expired, or has an invalid signature. This is the ONLY place a sessionId or scope
 * should come from — anything the client sends directly is untrusted.
 */
export function readSessionToken(
  token: string | null | undefined,
  secret: string,
): VerifiedSession | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== TOKEN_VERSION) return null;

  const [version, scope, sessionId, expiresAtText, signature] = parts;
  if (!sessionId || !VALID_SCOPES.has(scope)) return null;

  const expiresAt = Number(expiresAtText);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  // Constant-time comparison so the signature can't be probed byte by byte.
  // timingSafeEqual throws on length mismatch, so guard that case first.
  const expected = signPayload(`${version}.${scope}.${sessionId}.${expiresAtText}`, secret);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  return { sessionId, scope: scope as SessionScope };
}

/** True for a well-formed, unexpired, correctly-signed token. For callers that only
 *  need proof-of-humanness and don't care which session it is (e.g. chat). */
export function isValidSessionToken(
  token: string | null | undefined,
  secret: string,
): boolean {
  return readSessionToken(token, secret) !== null;
}

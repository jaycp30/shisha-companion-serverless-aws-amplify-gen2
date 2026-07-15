import { client } from './amplify';
import { getTurnstileToken } from './turnstile';

// Client side of the proof-of-humanness handshake: run one Turnstile challenge, trade
// its single-use token for our reusable HMAC session token (see the mintSessionToken
// backend op), and cache it for the rest of the visit. Every protected call
// (getUploadUrl, chat) sends this token along.
//
// Deliberately memory-only (no localStorage): the token is a credential, and a fresh
// visit re-challenging invisibly is cheap — same reasoning as the per-pageload
// SESSION_ID in analyzeMenu.ts.

// Renew this long before expiry, so a token can't lapse mid-flow (e.g. between the
// presign and the analysis of a slow multi-page upload).
const RENEW_MARGIN_SECONDS = 5 * 60;

// The marker the backend puts in its rejection message — seeing it means "mint a
// fresh token and retry", not "give up". Must match the handlers' thrown Error text.
export const SESSION_EXPIRED_MARKER = 'Session expired';

/** Errors with a message safe to show the user. */
export class SessionTokenError extends Error {}

let cached: { token: string; expiresAt: number } | null = null;
// Concurrent callers (parallel presigns!) share one in-flight mint instead of each
// spawning their own Turnstile challenge.
let pending: Promise<string> | null = null;

/** Get a valid session token, running the Turnstile handshake only when needed. */
export async function getSessionToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - now > RENEW_MARGIN_SECONDS) {
    return cached.token;
  }
  pending ??= mint().finally(() => {
    pending = null;
  });
  return pending;
}

/** Drop the cached token — call when the backend rejects it (clock skew, rotation). */
export function invalidateSessionToken(): void {
  cached = null;
}

async function mint(): Promise<string> {
  const turnstileToken = await getTurnstileToken();
  const minted = await client.mutations.mintSessionToken({ turnstileToken });
  if (minted.errors?.length || !minted.data) {
    throw new SessionTokenError(
      minted.errors?.[0]?.message ?? "Couldn't verify this session — please try again.",
    );
  }
  cached = { token: minted.data.token, expiresAt: minted.data.expiresAt };
  return cached.token;
}

// Server-side Cloudflare Turnstile verification, shared by any function that gates on
// a Turnstile challenge (today: mint-session-token). The frontend widget mints a
// single-use token; this asks Cloudflare's siteverify endpoint whether it is genuine.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Generous for a single HTTPS round trip, but well under the caller's Lambda timeout,
// so a slow Cloudflare surfaces as 'unavailable' (the caller's degraded path) rather
// than a function timeout.
const SITEVERIFY_TIMEOUT_MS = 5000;

// Three distinct outcomes the CALLER acts on — the helper no longer decides policy:
//   verified    — a genuine token that also matched the expected hostname/action.
//   rejected    — Cloudflare said no, or hostname/action mismatched. Always fail closed.
//   unavailable — we couldn't reach Cloudflare, so we know NOTHING. The caller decides
//                 (mint-session-token runs a tightly-capped degraded mode here).
export type TurnstileOutcome = 'verified' | 'rejected' | 'unavailable';

export interface TurnstileVerdict {
  outcome: TurnstileOutcome;
  /** Cloudflare's error codes (or our own mismatch markers) when rejected. */
  errorCodes: string[];
}

export interface TurnstileExpectations {
  /** If set, the challenge must have been solved on this hostname. */
  expectedHostname?: string;
  /** If set, the widget's `action` must equal this. */
  expectedAction?: string;
}

// The subset of the siteverify response we read.
interface SiteverifyBody {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
}

/**
 * Ask Cloudflare whether a Turnstile token is genuine, and (when configured) that it was
 * solved on our hostname for our action.
 *
 * A token Cloudflare REJECTS — or one whose hostname/action doesn't match — is 'rejected';
 * the caller must fail closed, that's the whole point of the feature. If the siteverify
 * call itself fails (timeout, 5xx, DNS) the outcome is 'unavailable' with a loud log
 * marker: we cannot vouch for the token, and it is up to the caller whether to degrade or
 * refuse. The marker string below is what a CloudWatch metric filter / alarm should watch.
 */
export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  expectations: TurnstileExpectations = {},
): Promise<TurnstileVerdict> {
  let body: SiteverifyBody;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: token }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`siteverify returned HTTP ${response.status}`);
    }
    body = (await response.json()) as SiteverifyBody;
  } catch (error) {
    console.error('TURNSTILE_VERIFY_UNAVAILABLE — could not reach siteverify:', error);
    return { outcome: 'unavailable', errorCodes: [] };
  }

  // Cloudflare actively rejected the token.
  if (body.success !== true) {
    return { outcome: 'rejected', errorCodes: body['error-codes'] ?? [] };
  }

  // Genuine token — now enforce that it was solved where and for what we expect. Both
  // checks are opt-in (skipped when the expected value is not configured) so sandbox
  // test keys, which don't echo a real hostname/action, keep working.
  const { expectedHostname, expectedAction } = expectations;
  if (expectedHostname && body.hostname !== expectedHostname) {
    console.error(
      `TURNSTILE_HOSTNAME_MISMATCH — got '${body.hostname}', expected '${expectedHostname}'`,
    );
    return { outcome: 'rejected', errorCodes: ['hostname-mismatch'] };
  }
  if (expectedAction && body.action !== expectedAction) {
    console.error(
      `TURNSTILE_ACTION_MISMATCH — got '${body.action}', expected '${expectedAction}'`,
    );
    return { outcome: 'rejected', errorCodes: ['action-mismatch'] };
  }

  return { outcome: 'verified', errorCodes: [] };
}

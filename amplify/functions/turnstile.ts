// Server-side Cloudflare Turnstile verification, shared by any function that gates on
// a Turnstile challenge (today: mint-session-token). The frontend widget mints a
// single-use token; this asks Cloudflare's siteverify endpoint whether it is genuine.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Generous for a single HTTPS round trip, but well under the caller's Lambda timeout,
// so a slow Cloudflare degrades into the fail-open path instead of a function timeout.
const SITEVERIFY_TIMEOUT_MS = 5000;

export interface TurnstileVerdict {
  ok: boolean;
  /** True when `ok` is true only because Cloudflare was unreachable (fail-open). */
  failedOpen: boolean;
  /** Cloudflare's error codes when the token was actually rejected. */
  errorCodes: string[];
}

/**
 * Ask Cloudflare whether a Turnstile token is genuine.
 *
 * Policy (deliberate): a token Cloudflare REJECTS is always refused — that is the whole
 * point of the feature. But if the siteverify call itself fails (timeout, 5xx, DNS),
 * we cannot know either way, and we fail OPEN with a loud log marker rather than let a
 * Cloudflare outage take the app down: the DynamoDB rate limiter and the account's
 * Bedrock budget alarms cap the damage for that window. The marker string below is
 * what a CloudWatch metric filter / alarm should watch for.
 */
export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
): Promise<TurnstileVerdict> {
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
    const body = (await response.json()) as {
      success?: boolean;
      'error-codes'?: string[];
    };
    return {
      ok: body.success === true,
      failedOpen: false,
      errorCodes: body['error-codes'] ?? [],
    };
  } catch (error) {
    console.error(
      'TURNSTILE_VERIFY_UNAVAILABLE — allowing request without verification:',
      error,
    );
    return { ok: true, failedOpen: true, errorCodes: [] };
  }
}

import { env } from '$amplify/env/mint-session-token';
import type { Schema } from '../../data/resource';
import { verifyTurnstileToken } from '../turnstile';
import { createSessionToken } from '../session-token';
import { checkRateLimit } from '../rate-limit';

// Full token: long enough to cover a full lounge visit (shisha sessions run hours), short
// enough that a leaked token goes stale the same evening. The client renews automatically
// near expiry, so this is not a UX ceiling — just a blast-radius cap.
const SESSION_TOKEN_TTL_SECONDS = 4 * 60 * 60;

// Degraded token: minted only when Cloudflare siteverify is UNREACHABLE, so we can't prove
// the caller is human. Kept short so each one's blast radius is tiny; the client just
// renews more often (still comfortably above its 5-min renew margin). The action the
// widget must have declared, and the expected hostname, gate the real (verified) path.
const DEGRADED_TTL_SECONDS = 15 * 60;
const EXPECTED_ACTION = 'mint';

// Global budget on degraded mints across ALL callers, so a Cloudflare outage can't be
// used to mint an unlimited supply of un-verified tokens. Sized for a handful of real
// visitors during a rare outage while stopping a script cold; exhausting it fails closed.
const DEGRADED_MINT_LIMIT = 20;
const DEGRADED_MINT_WINDOW_SECONDS = 600;

export const handler: Schema['mintSessionToken']['functionHandler'] = async (event) => {
  const { turnstileToken } = event.arguments;

  // Hostname + action are only enforced when an expected hostname is configured (prod);
  // sandbox/test keys don't echo a real hostname, so leaving it unset skips both checks.
  // Read from process.env (like RATE_LIMIT_TABLE_NAME): it's a plain infra string, and
  // this keeps the typecheck green before the first synth regenerates the typed `env`.
  const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME || undefined;
  const verdict = await verifyTurnstileToken(turnstileToken, env.TURNSTILE_SECRET_KEY, {
    expectedHostname,
    expectedAction: expectedHostname ? EXPECTED_ACTION : undefined,
  });

  if (verdict.outcome === 'verified') {
    return createSessionToken(env.SESSION_TOKEN_SECRET, SESSION_TOKEN_TTL_SECONDS, 'full');
  }

  if (verdict.outcome === 'rejected') {
    // Cloudflare said no, or the hostname/action didn't match — fail closed, that's the
    // feature. The exact message matters: the frontend detects it and re-challenges.
    console.error('Turnstile rejected a token:', verdict.errorCodes.join(', '));
    throw new Error('Human check failed — refresh the page and try again.');
  }

  // outcome === 'unavailable': we could not reach Cloudflare, so we can't vouch for the
  // caller. Rather than fail the whole app closed on a rare siteverify outage, mint a
  // SHORT-lived degraded token — but only while a small global budget lasts, so the outage
  // can't be turned into an unlimited token faucet. The budget check itself fails closed
  // (checkRateLimit denies if the table is unreachable), so a double outage refuses too.
  const budget = await checkRateLimit(
    'degraded-mint',
    'global',
    DEGRADED_MINT_LIMIT,
    DEGRADED_MINT_WINDOW_SECONDS,
  );
  if (!budget.allowed) {
    console.error(
      `DEGRADED_MINT_BUDGET_EXHAUSTED — refusing degraded mint (reason=${budget.reason}).`,
    );
    throw new Error('Human check is temporarily unavailable — please try again shortly.');
  }

  console.warn('TURNSTILE_DEGRADED_MINT — issuing a short-lived unverified session token.');
  return createSessionToken(env.SESSION_TOKEN_SECRET, DEGRADED_TTL_SECONDS, 'degraded');
};

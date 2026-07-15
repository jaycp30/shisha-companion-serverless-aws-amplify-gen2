import { env } from '$amplify/env/mint-session-token';
import type { Schema } from '../../data/resource';
import { verifyTurnstileToken } from '../turnstile';
import { createSessionToken } from '../session-token';

// Long enough to cover a full lounge visit (shisha sessions run hours), short enough
// that a leaked token goes stale the same evening. The client renews automatically
// near expiry, so this is not a UX ceiling — just a blast-radius cap.
const SESSION_TOKEN_TTL_SECONDS = 4 * 60 * 60;

export const handler: Schema['mintSessionToken']['functionHandler'] = async (event) => {
  const { turnstileToken } = event.arguments;

  const verdict = await verifyTurnstileToken(turnstileToken, env.TURNSTILE_SECRET_KEY);
  if (!verdict.ok) {
    // A token Cloudflare actively rejected — fail closed, that's the feature.
    console.error('Turnstile rejected a token:', verdict.errorCodes.join(', '));
    throw new Error('Human check failed — refresh the page and try again.');
  }

  return createSessionToken(env.SESSION_TOKEN_SECRET, SESSION_TOKEN_TTL_SECONDS);
};

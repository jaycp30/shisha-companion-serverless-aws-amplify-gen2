import { defineFunction, secret } from '@aws-amplify/backend';

// Exchanges a Cloudflare Turnstile token (single-use, minutes-lived) for our own
// reusable HMAC session token (hours-lived) — the one place siteverify is called.
// Both values are Amplify secrets (SSM-backed), never in code:
//   npx ampx sandbox secret set TURNSTILE_SECRET_KEY   (Cloudflare dashboard)
//   npx ampx sandbox secret set SESSION_TOKEN_SECRET   (any long random string)
export const mintSessionToken = defineFunction({
  name: 'mint-session-token',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 10,
  memoryMB: 256,
  environment: {
    TURNSTILE_SECRET_KEY: secret('TURNSTILE_SECRET_KEY'),
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
  },
});

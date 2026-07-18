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
  // Live in the data stack (like chat/analyze-menu): mint now reads+writes the RateLimit
  // table (in the data stack) for its degraded-mint budget. Without this, mint sits in the
  // default function stack that the data stack already depends on (mint is a data
  // resolver), and granting it a data-stack table closes a data<->function cycle.
  resourceGroupName: 'data',
  environment: {
    TURNSTILE_SECRET_KEY: secret('TURNSTILE_SECRET_KEY'),
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
  },
  // Note: TURNSTILE_EXPECTED_HOSTNAME is injected in backend.ts via addEnvironment, NOT
  // here — this file is pulled into the FRONTEND tsconfig graph (src imports Schema from
  // data/resource, which imports this), so it must stay free of Node globals like
  // `process`.
});

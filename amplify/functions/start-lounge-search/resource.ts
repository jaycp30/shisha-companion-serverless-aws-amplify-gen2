import { defineFunction, secret } from '@aws-amplify/backend';

// Starts a lounge web-search job after proving the caller passed Turnstile (signed session
// token). First checks the location cache and, on a hit, returns a copied finished job
// instead of paying for a fresh search. The job table name + GSI name are injected in
// backend.ts (plain CDK table), so they're read from process.env, not the typed env.
export const startLoungeSearch = defineFunction({
  name: 'start-lounge-search',
  entry: './handler.ts',
  runtime: 22,
  resourceGroupName: 'data',
  timeoutSeconds: 10,
  memoryMB: 256,
  environment: {
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
  },
});

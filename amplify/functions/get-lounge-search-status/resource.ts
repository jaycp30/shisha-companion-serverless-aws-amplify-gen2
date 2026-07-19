import { defineFunction, secret } from '@aws-amplify/backend';

// Polls one lounge-search job's status — and ONLY if the caller's session owns it. Clone of
// get-menu-analysis-status: wrong owner and missing job both return NOT_FOUND, so this can't
// enumerate other sessions' jobs. The job table name is injected in backend.ts (plain CDK
// table), read from process.env.
export const getLoungeSearchStatus = defineFunction({
  name: 'get-lounge-search-status',
  entry: './handler.ts',
  runtime: 22,
  resourceGroupName: 'data',
  timeoutSeconds: 10,
  memoryMB: 256,
  environment: {
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
  },
});

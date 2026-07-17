import { defineFunction, secret } from '@aws-amplify/backend';

// Returns the status/result of ONE menu job, and only to the session that created it.
// Replaces the public MenuAnalysis subscription/get, which exposed every job to anyone.
// The client polls this with backoff. Table name is injected via process.env in backend.ts.
export const getMenuAnalysisStatus = defineFunction({
  name: 'get-menu-analysis-status',
  entry: './handler.ts',
  runtime: 22,
  resourceGroupName: 'data',
  timeoutSeconds: 10,
  memoryMB: 256,
  environment: {
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
  },
});

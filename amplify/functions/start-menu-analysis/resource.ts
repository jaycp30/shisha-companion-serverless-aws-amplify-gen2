import { defineFunction, secret } from '@aws-amplify/backend';

// Creates a menu-analysis job on behalf of an anonymous caller, AFTER proving the
// caller owns the pages they're submitting. Replaces the old public MenuAnalysis.create,
// which let anyone create/list/modify/delete any job. The job table name is injected in
// backend.ts (it's a plain CDK table), so it's read from process.env, not the typed env.
export const startMenuAnalysis = defineFunction({
  name: 'start-menu-analysis',
  entry: './handler.ts',
  runtime: 22,
  resourceGroupName: 'data',
  timeoutSeconds: 10,
  memoryMB: 256,
  environment: {
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
  },
});

import { defineFunction } from '@aws-amplify/backend';

// The async lounge web-search worker. NOT an AppSync resolver — it is triggered by the
// LoungeSearchJobs table's DynamoDB stream (wired in backend.ts), calls Claude Platform on
// AWS (Claude + hosted web_search) for lounges near the job's location, and writes the
// result back onto the job row with the DynamoDB SDK (see lounge-jobs.ts).
//
// - resourceGroupName 'data': the worker hangs off the LoungeSearchJobs table stream, which
//   lives in the data stack. Co-locating avoids a cross-stack dependency.
// - timeout 120s: a hosted web-search loop can take 30-60s, well past AppSync's ~30s
//   ceiling — which is exactly why this runs as a background job, not a resolver.
// - ANTHROPIC_AWS_WORKSPACE_ID is injected in backend.ts from the env (a per-environment
//   value, set as an Amplify branch var in prod), so it's read from process.env there.
export const loungeSearch = defineFunction({
  name: 'lounge-search',
  entry: './handler.ts',
  runtime: 22,
  resourceGroupName: 'data',
  timeoutSeconds: 120,
  memoryMB: 512,
});

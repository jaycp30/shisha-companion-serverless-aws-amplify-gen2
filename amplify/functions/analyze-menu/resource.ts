import { defineFunction } from '@aws-amplify/backend';
import { MODEL_ID } from '../model';

// The async menu-analysis worker. It is NOT an AppSync resolver — it is triggered by the
// MenuJobs table's DynamoDB stream (wired in backend.ts), reads the uploaded pages from
// S3, asks Claude (vision) for structured recommendations, and writes the result back
// onto the job row with the DynamoDB SDK (see menu-jobs.ts).
//
// - resourceGroupName 'data': the worker hangs off the MenuJobs table stream, and that
//   table lives in the data stack. Co-locating avoids a cross-stack dependency.
// - timeout 120s: a multi-page vision call can take ~30-50s. Freed from AppSync's ~30s
//   ceiling now that this runs as a background job, so we can give it real headroom.
export const analyzeMenu = defineFunction({
  name: 'analyze-menu',
  entry: './handler.ts',
  runtime: 22,
  resourceGroupName: 'data',
  timeoutSeconds: 120,
  memoryMB: 512,
  environment: { MODEL_ID },
});

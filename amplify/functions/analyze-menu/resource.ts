import { defineFunction } from '@aws-amplify/backend';
import { MODEL_ID } from '../model';

// The async menu-analysis worker. It is NOT an AppSync resolver — it is triggered by the
// MenuAnalysis table's DynamoDB stream (wired in backend.ts), reads the uploaded pages
// from S3, asks Claude (vision) for structured recommendations, and writes the result
// back onto the job row via the data client.
//
// - resourceGroupName 'data': the worker both reads the data API AND hangs off its table
//   stream. Co-locating it in the data stack avoids a circular dependency between stacks.
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

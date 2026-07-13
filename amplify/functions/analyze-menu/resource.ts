import { defineFunction } from '@aws-amplify/backend';
import { MODEL_ID } from '../model';

// Reads the uploaded menu photo from S3 and asks Claude (vision) to return a
// structured recommendation JSON. Vision calls are slower, so give it 60s.
export const analyzeMenu = defineFunction({
  name: 'analyze-menu',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60,
  memoryMB: 512,
  environment: { MODEL_ID },
});

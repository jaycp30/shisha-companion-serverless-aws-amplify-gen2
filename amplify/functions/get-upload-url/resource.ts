import { defineFunction } from '@aws-amplify/backend';

// Returns a short-lived presigned S3 PUT URL so the browser can upload the menu
// photo directly to S3 (the bytes never pass through this Lambda). Small + fast.
export const getUploadUrl = defineFunction({
  name: 'get-upload-url',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 15,
  memoryMB: 256,
});

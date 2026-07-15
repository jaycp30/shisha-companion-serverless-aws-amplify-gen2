import { defineFunction, secret } from '@aws-amplify/backend';

// Returns a short-lived presigned S3 PUT URL so the browser can upload the menu
// photo directly to S3 (the bytes never pass through this Lambda). Small + fast.
// SESSION_TOKEN_SECRET verifies the caller's HMAC session token (proof of a passed
// Turnstile challenge) before any URL is signed — see functions/session-token.ts.
export const getUploadUrl = defineFunction({
  name: 'get-upload-url',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 15,
  memoryMB: 256,
  environment: {
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
  },
});

import { defineFunction, secret } from '@aws-amplify/backend';
import { MODEL_ID } from '../model';

// Companion chat: short, cheap replies from the cat mascot persona. It also reads and
// writes CafeNote rows, and a function that both serves the data API and consumes it
// must live in the data stack (resourceGroupName) or the two stacks go circular.
// SESSION_TOKEN_SECRET verifies the caller's HMAC session token (proof of a passed
// Turnstile challenge) before the paid Bedrock call — see functions/session-token.ts.
export const chat = defineFunction({
  name: 'chat',
  entry: './handler.ts',
  runtime: 22,
  resourceGroupName: 'data',
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: {
    MODEL_ID,
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
  },
});

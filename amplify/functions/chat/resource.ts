import { defineFunction } from '@aws-amplify/backend';
import { MODEL_ID } from '../model';

// Companion chat: short, cheap replies from the cat mascot persona. It also reads and
// writes CafeNote rows, and a function that both serves the data API and consumes it
// must live in the data stack (resourceGroupName) or the two stacks go circular.
export const chat = defineFunction({
  name: 'chat',
  entry: './handler.ts',
  runtime: 22,
  resourceGroupName: 'data',
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: { MODEL_ID },
});

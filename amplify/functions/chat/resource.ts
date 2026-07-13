import { defineFunction } from '@aws-amplify/backend';
import { MODEL_ID } from '../model';

// Companion chat: short, cheap replies from the cat mascot persona.
export const chat = defineFunction({
  name: 'chat',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: { MODEL_ID },
});

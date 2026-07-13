import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { env } from '$amplify/env/chat';
import type { Schema } from '../../data/resource';
import { buildSystemPrompt } from './persona';

const bedrock = new BedrockRuntimeClient();

// Companion replies are short; cap tokens to keep latency and cost low.
const MAX_TOKENS = 512;
// Only send the last few turns to Bedrock (rx-reader pattern): enough context,
// bounded cost, no unbounded history growth.
const MAX_HISTORY = 6;
// Higher temperature: chat should feel lively, not robotic.
const TEMPERATURE = 0.8;

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export const handler: Schema['chat']['functionHandler'] = async (event) => {
  const { messagesJson, menuJson, sessionJson } = event.arguments;

  // The frontend sends the running transcript as JSON; keep only the tail.
  const history: ChatMessage[] = JSON.parse(messagesJson);
  const recent = history.slice(-MAX_HISTORY);

  const messages: Message[] = recent.map((m) => ({
    role: m.role,
    content: [{ text: m.text }],
  }));

  const response = await bedrock.send(
    new ConverseCommand({
      modelId: env.MODEL_ID,
      system: [{ text: buildSystemPrompt(menuJson ?? undefined, sessionJson ?? undefined) }],
      messages,
      inferenceConfig: { maxTokens: MAX_TOKENS, temperature: TEMPERATURE },
    }),
  );

  return response.output?.message?.content?.[0]?.text ?? '';
};

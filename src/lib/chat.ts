import { client } from './amplify';
import type { MenuAnalysis } from '../types/menu';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * What the cat is told about your current session.
 *
 * Note `pace` is a coarse bucket, not a puff count. That's deliberate: handing the
 * model a raw number invites it to talk about quantity, and this app never comments on
 * how much you smoke — only on going too fast. A bucket can say "slow down"; it can't
 * say "you've had nine".
 */
export interface ChatSessionContext {
  elapsedMinutes: number;
  coalsMinutes: number;
  coalsExpired: boolean;
  pace: 'ok' | 'fast';
}

/** The Lambda keeps only the last 6 turns; sending much more is just wasted bytes. */
const MAX_HISTORY_SENT = 8;

export class ChatError extends Error {}

interface SendChatOptions {
  /** Marks this message as the reply to the cat's café question — the backend distills
      it into an anonymous note other visitors' cats can draw on. */
  captureNote?: boolean;
}

export async function sendChat(
  messages: ChatMessage[],
  menu: MenuAnalysis | null,
  session: ChatSessionContext,
  { captureNote }: SendChatOptions = {},
): Promise<string> {
  const response = await client.queries.chat({
    messagesJson: JSON.stringify(messages.slice(-MAX_HISTORY_SENT)),
    menuJson: menu ? JSON.stringify(menu) : undefined,
    sessionJson: JSON.stringify(session),
    // The venue ties this chat to its café notes; the Lambda normalizes it into a key.
    storeName: menu?.store_name ?? undefined,
    captureNote,
  });

  if (response.errors?.length || !response.data) {
    throw new ChatError(response.errors?.[0]?.message ?? "The cat didn't answer.");
  }

  return response.data;
}

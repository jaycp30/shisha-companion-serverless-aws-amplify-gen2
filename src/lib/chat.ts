import { client } from './amplify';
import {
  getSessionToken,
  invalidateSessionToken,
  SESSION_EXPIRED_MARKER,
} from './sessionToken';
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
  /** Send as a signed-in curator, so any note captured is recorded as verified. */
  asCurator?: boolean;
}

export async function sendChat(
  messages: ChatMessage[],
  menu: MenuAnalysis | null,
  session: ChatSessionContext,
  { captureNote, asCurator }: SendChatOptions = {},
): Promise<string> {
  const args = {
    messagesJson: JSON.stringify(messages.slice(-MAX_HISTORY_SENT)),
    menuJson: menu ? JSON.stringify(menu) : undefined,
    sessionJson: JSON.stringify(session),
    // The venue ties this chat to its café notes; the Lambda normalizes it into a key.
    storeName: menu?.store_name ?? undefined,
    captureNote,
  };

  // Curators call through Cognito so AppSync populates the Lambda's `identity` — that
  // authenticated context, not any argument we could send, is what earns a note its
  // verified mark. Anonymous visitors keep using the default API key.
  const options = asCurator ? ({ authMode: 'userPool' } as const) : undefined;

  let response = await client.queries.chat(
    { ...args, sessionToken: await getSessionToken() },
    options,
  );

  // A rejected session token is self-healing: mint a fresh one (may re-run the
  // invisible Turnstile check) and retry ONCE. Any other error falls through as-is.
  if (response.errors?.some((e) => e.message.includes(SESSION_EXPIRED_MARKER))) {
    invalidateSessionToken();
    response = await client.queries.chat(
      { ...args, sessionToken: await getSessionToken() },
      options,
    );
  }

  if (response.errors?.length || !response.data) {
    throw new ChatError(response.errors?.[0]?.message ?? "The cat didn't answer.");
  }

  return response.data;
}

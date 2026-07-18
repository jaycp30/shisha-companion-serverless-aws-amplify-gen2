import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  ChatError,
  sendChat,
  type ChatMessage,
  type ChatSessionContext,
} from '../lib/chat';
import type { MenuAnalysis } from '../types/menu';

// How tall the input may grow before it scrolls internally — about six lines of
// text-sm/leading-relaxed plus padding. Keeps a long prompt fully visible without
// letting the composer swallow the conversation above it.
const MAX_INPUT_HEIGHT_PX = 144;

interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The analyzed menu, if one exists — gives the cat something to talk about. */
  menu: MenuAnalysis | null;
  session: ChatSessionContext;
  /** Lets the mascot switch to its 'talking' clip while a reply is in flight. */
  onTalkingChange: (talking: boolean) => void;
  /** A question the CAT asks proactively (the café check-in). Planted as an assistant
      message when the drawer opens; the user's next message becomes a café note. */
  seedQuestion: string | null;
  onSeedConsumed: () => void;
  /** True when a curator is signed in — their captured notes are stored as verified. */
  isCurator: boolean;
}

/**
 * On desktop this docks to the right edge full-height, and App shifts the content
 * column left so you can keep scrolling your recommendations while you chat.
 *
 * On small screens it's a bottom sheet instead — a side-by-side split needs horizontal
 * room that a phone simply doesn't have, so trying to force one there would just give
 * you two unusable columns.
 */
export function ChatDrawer({
  open,
  onClose,
  menu,
  session,
  onTalkingChange,
  seedQuestion,
  onSeedConsumed,
  isCurator,
}: ChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const reduceMotion = useReducedMotion();

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // True while the next user message is the answer to the cat's café question.
  const captureNextRef = useRef(false);

  // Move focus into the sheet when it opens so a keyboard user lands in the composer
  // rather than being stranded on <body> behind an invisible modal. Focus is restored to
  // the chat trigger on close by App (the trigger unmounts while the sheet is open).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Modal keyboard behaviour: Escape closes, and Tab is trapped inside the sheet so focus
  // can't wander to the (inert-to-the-eye but still tabbable) page behind it.
  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !sectionRef.current) return;
    const focusable = Array.from(
      sectionRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Plant the cat's proactive question as a normal assistant message the first time the
  // drawer opens while one is pending. The user's reply (their NEXT send) is flagged so
  // the backend can distill it into an anonymous café note.
  useEffect(() => {
    if (!open || !seedQuestion) return;
    setMessages((current) => [...current, { role: 'assistant', text: seedQuestion }]);
    captureNextRef.current = true;
    onSeedConsumed();
  }, [open, seedQuestion, onSeedConsumed]);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Grow the input with its content so a long prompt stays fully visible, capped at
  // ~6 lines (it scrolls internally past that). Measured by hand because the CSS
  // `field-sizing: content` shortcut doesn't exist in Firefox. Keying the effect on
  // `input` also collapses the box back to one line when send() clears it.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [input]);

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || sending) return;

    // Render the user's own message immediately. Waiting for the round-trip to see
    // your own words makes an app feel broken.
    const history: ChatMessage[] = [...messages, { role: 'user', text }];
    setMessages(history);
    setInput('');
    setError('');
    setSending(true);
    onTalkingChange(true);

    // Consume the capture flag whatever happens — a failed send shouldn't leave the
    // NEXT unrelated message being stored as a café note.
    const captureNote = captureNextRef.current;
    captureNextRef.current = false;

    try {
      const reply = await sendChat(history, menu, session, {
        captureNote,
        asCurator: isCurator,
      });
      setMessages([...history, { role: 'assistant', text: reply }]);
    } catch (err) {
      setError(
        err instanceof ChatError
          ? err.message
          : "Can't reach the cat's brain right now — check your connection. 🐾",
      );
    } finally {
      setSending(false);
      onTalkingChange(false);
    }
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    void send();
  }

  // Enter sends; Shift+Enter inserts a newline. The isComposing guard matters for IME
  // input (Japanese etc.): there, Enter confirms the character you're composing, and
  // without the guard picking a kanji candidate would fire the message off mid-word.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          ref={sectionRef}
          onKeyDown={handleDialogKeyDown}
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-heading"
          className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[70dvh] w-full max-w-xl flex-col rounded-t-3xl border border-petal bg-cream/95 backdrop-blur-sm lg:inset-y-0 lg:left-auto lg:right-0 lg:mx-0 lg:h-dvh lg:max-h-none lg:w-[24rem] lg:max-w-none lg:rounded-none lg:rounded-l-3xl"
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 300, damping: 32 }}
        >
          <header className="flex items-center justify-between border-b border-petal px-5 py-3">
            <h2 id="chat-heading" className="text-sm font-semibold">Chat with the cat 🐾</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1 text-sm text-espresso-soft transition hover:bg-petal-soft"
              aria-label="Close chat"
            >
              Close
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {messages.length === 0 && (
              <p className="text-sm leading-relaxed text-espresso-soft">
                {menu
                  ? 'Ask me about your menu, the picks, or just hang out. 🐾'
                  : 'Upload a menu and I can talk you through it — or just chat. 🐾'}
              </p>
            )}

            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                {/* pre-wrap so the newlines a user typed (Shift+Enter) survive rendering. */}
                <p
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'bg-petal text-espresso'
                      : 'border border-petal bg-linen text-espresso'
                  }`}
                >
                  {message.text}
                </p>
              </div>
            ))}

            {sending && (
              <p className="text-sm text-espresso-soft" role="status">
                the cat is thinking…
              </p>
            )}

            {error && (
              <p className="rounded-xl bg-petal-soft px-4 py-3 text-sm" role="alert">
                {error}
              </p>
            )}

            <div ref={endRef} />
          </div>

          {/* items-end keeps the Send button pinned to the bottom row while the
              textarea grows upward. */}
          <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-petal p-4">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Say something… (Shift+Enter for a new line)"
              aria-label="Message"
              className="min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border border-petal bg-linen px-4 py-2.5 text-sm leading-relaxed text-espresso placeholder:text-espresso-soft focus:border-espresso-soft"
            />
            <button
              type="submit"
              disabled={sending || input.trim() === ''}
              className="rounded-full bg-petal px-5 py-2.5 text-sm font-medium text-espresso transition hover:brightness-95 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

import type { MascotState } from '../config/mascot';
import type { SessionNotice } from '../hooks/useSession';
import { Mascot } from './Mascot';
import { MascotBubble } from './MascotBubble';

interface MascotDockProps {
  state: MascotState;
  notice: SessionNotice | null;
  chatOpen: boolean;
  onClipEnd: () => void;
  onTap: () => void;
  /** What the tap does right now — see Mascot. */
  tapLabel: string;
  onDismissNotice: () => void;
  onOpenChat: () => void;
}

/**
 * The cat's corner: speech bubble, cat, and the chat button, stacked as one unit.
 *
 * Grouping them means the bubble and button follow the cat automatically — including
 * when the whole dock slides left to make room for the docked chat panel on desktop.
 * (The panel is ~24rem wide, hence the translate. On smaller screens the chat is a
 * bottom sheet instead, so nothing moves.)
 */
export function MascotDock({
  state,
  notice,
  chatOpen,
  onClipEnd,
  onTap,
  tapLabel,
  onDismissNotice,
  onOpenChat,
}: MascotDockProps) {
    // Narrower on phones (w-32) so it clears the session HUD in the opposite corner;
    // full size from sm up. Respects the safe-area (notch / home indicator). On small
    // screens the chat is a bottom sheet that covers this corner, so the whole dock hides
    // while chatting rather than sitting behind the sheet; on lg+ the chat is a side
    // panel and the dock slides left to stay visible beside it.
  return (
    <div
      className={`fixed z-30 flex w-32 flex-col items-center gap-2 transition-transform duration-300 sm:w-56 bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] ${
        chatOpen ? 'max-lg:hidden lg:-translate-x-[25rem]' : ''
      }`}
    >
      <MascotBubble notice={notice} onDismiss={onDismissNotice} />

      <Mascot state={state} onClipEnd={onClipEnd} onTap={onTap} tapLabel={tapLabel} />

      {!chatOpen && (
        <button
          type="button"
          id="chat-trigger"
          onClick={onOpenChat}
          className="w-full rounded-full border border-petal bg-cream/95 px-3 py-2 text-xs font-medium text-espresso backdrop-blur-sm transition hover:bg-petal-soft"
        >
          {/* Short label on phones where the dock is only w-32; full invitation from sm up. */}
          <span className="sm:hidden">Chat 🐾</span>
          <span className="hidden sm:inline">Chat with the cat 🐾</span>
        </button>
      )}
    </div>
  );
}

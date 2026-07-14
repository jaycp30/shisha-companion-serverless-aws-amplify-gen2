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
  onDismissNotice,
  onOpenChat,
}: MascotDockProps) {
  return (
    <div
      className={`fixed bottom-3 right-3 z-30 flex w-40 flex-col items-center gap-2 transition-transform duration-300 sm:w-56 ${
        chatOpen ? 'lg:-translate-x-[25rem]' : ''
      }`}
    >
      <MascotBubble notice={notice} onDismiss={onDismissNotice} />

      <Mascot state={state} onClipEnd={onClipEnd} onTap={onTap} />

      {!chatOpen && (
        <button
          type="button"
          onClick={onOpenChat}
          className="w-full rounded-full border border-petal bg-cream/95 px-3 py-2 text-xs font-medium text-espresso backdrop-blur-sm transition hover:bg-petal-soft"
        >
          Chat with the cat 🐾
        </button>
      )}
    </div>
  );
}

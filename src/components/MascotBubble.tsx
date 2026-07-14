import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { SessionNotice } from '../hooks/useSession';

interface MascotBubbleProps {
  notice: SessionNotice | null;
  onDismiss: () => void;
}

/**
 * The cat's speech bubble — pacing nudges, break reminders, charcoal warnings.
 *
 * Positioned ABSOLUTELY inside MascotDock (`bottom-full` = directly above its sibling
 * cat), not fixed to the viewport. That's what lets it follow the cat around when the
 * dock slides aside for the chat panel, and it means no hand-tuned pixel offsets to
 * keep in sync with the mascot's size.
 *
 * `role="status"` (not "alert") is deliberate: these are gentle, non-urgent messages,
 * and a screen reader should mention them politely rather than interrupt.
 */
export function MascotBubble({ notice, onDismiss }: MascotBubbleProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {notice && (
        <motion.div
          key={notice.id}
          className="absolute bottom-full right-0 mb-3 w-max max-w-[15rem]"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.85, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.9, y: 8 }}
          // A spring, not a fade: it should POP, the way a game bark does.
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          // Grow out of the cat's corner rather than from the bubble's own middle.
          style={{ transformOrigin: 'bottom right' }}
        >
          <button
            type="button"
            onClick={onDismiss}
            role="status"
            className="relative block whitespace-normal rounded-2xl border border-petal bg-cream/95 px-4 py-3 text-left text-sm leading-snug text-espresso backdrop-blur-sm transition hover:bg-petal-soft"
          >
            {notice.text}

            {/* The tail: a small square rotated 45deg showing only its outer two
                borders, so it reads as a point aimed at the cat below. */}
            <span
              aria-hidden="true"
              className="absolute -bottom-[7px] right-8 h-3 w-3 rotate-45 border-b border-r border-petal bg-cream/95"
            />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

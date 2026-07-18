import { SESSION_CONFIG } from '../config/session';
import type { Session } from '../hooks/useSession';
import { formatClock } from '../lib/time';

interface SessionHudProps {
  session: Session;
  collapsed: boolean;
  onToggle: () => void;
  /** Waves the cat goodbye and returns to the splash. */
  onEndSession: () => void;
  /** True while the chat is open. On small screens the chat is a bottom sheet that
      covers this corner, so the HUD hides rather than sitting uselessly behind it. */
  chatOpen: boolean;
}

// Shared anchor for every HUD variant. Pinned bottom-left, respecting the device
// safe-area (notch / home indicator) via env() with a sensible floor. Hidden on small
// screens while the chat sheet is open — it would only sit behind the sheet. `max-w`
// reserves a clear gutter for the mascot in the opposite corner so the two fixed
// controls can never intersect at narrow widths (the collision this fixes).
function anchorClasses(chatOpen: boolean, widthCapped: boolean): string {
  return [
    'fixed z-30',
    'bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))]',
    widthCapped ? 'max-w-[calc(100vw-10rem)]' : '',
    chatOpen ? 'max-lg:hidden' : '',
  ].join(' ');
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-widest text-espresso-soft">
        {label}
      </p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function SessionHud({
  session,
  collapsed,
  onToggle,
  onEndSession,
  chatOpen,
}: SessionHudProps) {
  const { started, elapsedSeconds, coalsSeconds, coalsExpired, recentPuffs } = session;

  // Before the coals are lit there is no session to report on — just an invitation to
  // start one. Showing 0:00 clocks would imply time is being tracked when it isn't.
  // Collapsed (e.g. chat is open), this shrinks to a single pill instead of a full card
  // so it doesn't loom in the corner — the same courtesy the started HUD already gave.
  if (!started) {
    if (collapsed) {
      return (
        <button
          type="button"
          onClick={session.lightCoals}
          aria-label="Light the coals to start a session"
          className={`${anchorClasses(chatOpen, false)} rounded-full bg-petal px-4 py-2 text-xs font-medium text-espresso backdrop-blur-sm transition hover:brightness-95`}
        >
          Light the coals 🔥
        </button>
      );
    }
    return (
      <aside
        className={`${anchorClasses(chatOpen, true)} w-56 rounded-2xl border border-petal bg-cream/95 p-4 backdrop-blur-sm`}
        aria-label="Session status"
      >
        <p className="text-[10px] font-medium uppercase tracking-widest text-espresso-soft">
          Not started
        </p>
        <p className="mt-1 text-xs leading-snug text-espresso-soft">
          The clocks start when you light up — browse the menu first.
        </p>
        <button
          type="button"
          onClick={session.lightCoals}
          className="mt-3 w-full rounded-full bg-petal px-4 py-2 text-sm font-medium text-espresso transition hover:brightness-95"
        >
          Light the coals 🔥
        </button>
      </aside>
    );
  }

  // Collapsed, the clocks still show — and spent coals still shout. A minimised widget
  // that swallows the one warning worth interrupting for would be worse than useless.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        aria-label="Expand session status"
        className={`${anchorClasses(chatOpen, true)} flex items-center gap-2 rounded-full border border-petal px-3 py-2 text-xs backdrop-blur-sm transition hover:bg-petal-soft sm:gap-3 sm:px-4 ${
          coalsExpired ? 'bg-petal' : 'bg-cream/95'
        }`}
      >
        {/* Labels drop away below sm so the pill stays narrow enough to clear the mascot
            in the opposite corner; the clocks alone read fine on a minimised widget, and
            the aria-label already names it for assistive tech. */}
        <span className="hidden text-espresso-soft sm:inline">session</span>
        <span className="font-semibold tabular-nums">{formatClock(elapsedSeconds)}</span>
        <span className="text-petal">·</span>
        <span className="hidden text-espresso-soft sm:inline">coals</span>
        <span className="font-semibold tabular-nums">{formatClock(coalsSeconds)}</span>
        <span aria-hidden="true" className="text-espresso-soft">
          ⌃
        </span>
      </button>
    );
  }

  return (
    <aside
      className={`${anchorClasses(chatOpen, true)} w-56 rounded-2xl border border-petal bg-cream/95 p-4 backdrop-blur-sm`}
      aria-label="Session status"
    >
      <div className="flex items-start justify-between">
        <div className="flex gap-6">
          <Stat label="Session" value={formatClock(elapsedSeconds)} />
          <Stat label="Coals" value={formatClock(coalsSeconds)} />
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded
          aria-label="Minimize session status"
          className="-mr-1 -mt-1 rounded-full px-2 py-1 text-sm leading-none text-espresso-soft transition hover:bg-petal-soft"
        >
          &minus;
        </button>
      </div>

      {coalsExpired && (
        <p className="mt-2 text-xs leading-snug text-espresso">
          Coals are spent — time for a change.
        </p>
      )}

      <button
        type="button"
        onClick={session.lightCoals}
        className={`mt-3 w-full rounded-full px-4 py-2 text-sm font-medium text-espresso transition hover:brightness-95 ${
          coalsExpired ? 'bg-petal' : 'bg-petal-soft'
        }`}
      >
        Changed the coals
      </button>

      {/* Tapping the cat does this too. The button exists so the feature is
          discoverable and reachable by keyboard, not only by tapping artwork. */}
      <button
        type="button"
        onClick={session.logPuff}
        className="mt-2 w-full rounded-full border border-petal px-4 py-2 text-sm font-medium text-espresso transition hover:bg-petal-soft"
      >
        Log a puff
      </button>

      <p className="mt-2 text-center text-[11px] text-espresso-soft">
        {recentPuffs} in the last {SESSION_CONFIG.puffWindowSeconds / 60} min
      </p>

      <button
        type="button"
        onClick={onEndSession}
        className="mt-3 w-full rounded-full px-4 py-2 text-xs text-espresso-soft transition hover:bg-petal-soft"
      >
        End session
      </button>
    </aside>
  );
}

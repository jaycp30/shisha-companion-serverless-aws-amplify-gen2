import { SESSION_CONFIG } from '../config/session';
import type { Session } from '../hooks/useSession';
import { formatClock } from '../lib/time';

interface SessionHudProps {
  session: Session;
  collapsed: boolean;
  onToggle: () => void;
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

export function SessionHud({ session, collapsed, onToggle }: SessionHudProps) {
  const { started, elapsedSeconds, coalsSeconds, coalsExpired, recentPuffs } = session;

  // Before the coals are lit there is no session to report on — just an invitation to
  // start one. Showing 0:00 clocks would imply time is being tracked when it isn't.
  if (!started) {
    return (
      <aside
        className="fixed bottom-4 left-4 z-30 w-56 rounded-2xl border border-petal bg-cream/95 p-4 backdrop-blur-sm"
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
        className={`fixed bottom-4 left-4 z-30 flex items-center gap-3 rounded-full border border-petal px-4 py-2 text-xs backdrop-blur-sm transition hover:bg-petal-soft ${
          coalsExpired ? 'bg-petal' : 'bg-cream/95'
        }`}
      >
        <span className="text-espresso-soft">session</span>
        <span className="font-semibold tabular-nums">{formatClock(elapsedSeconds)}</span>
        <span className="text-petal">|</span>
        <span className="text-espresso-soft">coals</span>
        <span className="font-semibold tabular-nums">{formatClock(coalsSeconds)}</span>
        <span aria-hidden="true" className="text-espresso-soft">
          ⌃
        </span>
      </button>
    );
  }

  return (
    <aside
      className="fixed bottom-4 left-4 z-30 w-56 rounded-2xl border border-petal bg-cream/95 p-4 backdrop-blur-sm"
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
    </aside>
  );
}

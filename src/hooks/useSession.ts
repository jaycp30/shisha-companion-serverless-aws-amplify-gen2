import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ONE_SHOT_MS, SESSION_CONFIG } from '../config/session';

export interface SessionNotice {
  /** Changes on every new notice, so React re-runs the auto-dismiss timer. */
  id: number;
  text: string;
}

export interface Session {
  /** False until the coals are lit (or the first puff is logged). */
  started: boolean;
  elapsedSeconds: number;
  coalsSeconds: number;
  coalsExpired: boolean;
  isSleepy: boolean;
  /** Puffs logged inside the rolling pacing window. */
  recentPuffs: number;
  totalPuffs: number;
  /** True briefly after you go too fast — drives the cat's 'easy there' clip. */
  pacingNudge: boolean;
  notice: SessionNotice | null;
  logPuff: () => void;
  /** Lights the coals. The first light also starts the session clock. */
  lightCoals: () => void;
  dismissNotice: () => void;
}

/**
 * All session state lives client-side — there is no database, by design. Close the tab
 * and the session is gone, which is the right trade for a personal app.
 *
 * NOTHING TICKS UNTIL YOU LIGHT THE COALS. Browsing a menu is not a session: the app
 * used to start both clocks on page load, so the coals timer was already running while
 * you were still deciding what to order. Coals start when you light them.
 */
export function useSession(): Session {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [coalsAt, setCoalsAt] = useState<number | null>(null);
  const [puffs, setPuffs] = useState<number[]>([]);
  const [notice, setNotice] = useState<SessionNotice | null>(null);
  const [pacingNudge, setPacingNudge] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const started = startedAt !== null;

  // A single 1s tick drives every derived value — one interval for the whole session is
  // cheaper and far easier to reason about than a timer per widget. It only runs once
  // the session is actually under way.
  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [started]);

  const elapsedSeconds = startedAt === null ? 0 : Math.floor((now - startedAt) / 1000);
  const coalsSeconds = coalsAt === null ? 0 : Math.floor((now - coalsAt) / 1000);
  const coalsExpired = started && coalsSeconds >= SESSION_CONFIG.coalsMinutes * 60;
  const isSleepy = started && elapsedSeconds >= SESSION_CONFIG.sleepyAfterMinutes * 60;

  const windowMs = SESSION_CONFIG.puffWindowSeconds * 1000;
  const recentPuffs = useMemo(
    () => puffs.filter((at) => now - at <= windowMs).length,
    [puffs, now, windowMs],
  );

  // Going too fast. Because `recentPuffs` decays as old puffs age out of the window,
  // this flips back to false on its own — and can fire again later if you speed up
  // again, which is exactly what we want.
  const tooFast = recentPuffs > SESSION_CONFIG.puffLimit;
  useEffect(() => {
    if (!tooFast) return;
    setPacingNudge(true);
    setNotice({ id: Date.now(), text: 'Easy there — let the bowl breathe. 🐾' });
  }, [tooFast]);

  // The nudge is a one-shot: it plays, then decays.
  useEffect(() => {
    if (!pacingNudge) return;
    const id = window.setTimeout(() => setPacingNudge(false), ONE_SHOT_MS);
    return () => window.clearTimeout(id);
  }, [pacingNudge]);

  // Break reminder, on a fixed cadence. `remindersFired` tracks which interval we've
  // already announced, so it fires once per period rather than every tick.
  const remindersFired = useRef(0);
  useEffect(() => {
    if (!started) return;
    const periodSeconds = SESSION_CONFIG.breakReminderMinutes * 60;
    const due = Math.floor(elapsedSeconds / periodSeconds);
    if (due > remindersFired.current) {
      remindersFired.current = due;
      setNotice({
        id: Date.now(),
        text: 'Time to stretch, get some air, and sip some water. 🐾',
      });
    }
  }, [elapsedSeconds, started]);

  // Coals ran out — say so once, when it happens.
  const coalsAnnounced = useRef(false);
  useEffect(() => {
    if (coalsExpired && !coalsAnnounced.current) {
      coalsAnnounced.current = true;
      setNotice({ id: Date.now(), text: 'Charcoal time! Those coals are spent. 🐾' });
    }
  }, [coalsExpired]);

  // Notices fade on their own.
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(
      () => setNotice(null),
      SESSION_CONFIG.noticeSeconds * 1000,
    );
    return () => window.clearTimeout(id);
  }, [notice]);

  const lightCoals = useCallback(() => {
    const at = Date.now();
    coalsAnnounced.current = false;
    setCoalsAt(at);
    // The first light also starts the session clock.
    setStartedAt((current) => current ?? at);
    setNow(at);
  }, []);

  const logPuff = useCallback(() => {
    const at = Date.now();
    // If you're puffing, you're smoking — start the session rather than silently
    // dropping the puff on the floor.
    setStartedAt((current) => current ?? at);
    setCoalsAt((current) => current ?? at);
    setPuffs((previous) => [...previous, at]);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    started,
    elapsedSeconds,
    coalsSeconds,
    coalsExpired,
    isSleepy,
    recentPuffs,
    totalPuffs: puffs.length,
    pacingNudge,
    notice,
    logPuff,
    lightCoals,
    dismissNotice,
  };
}

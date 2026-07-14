/**
 * Every tunable threshold for the session companion lives here, so pacing can be
 * adjusted in one place instead of hunted through components.
 *
 * DESIGN RULE — THE PACING KEEPER IS ONE-DIRECTIONAL.
 * It only ever nudges you to slow down, take a break, or drink water. Nothing in this
 * app ever tells you to take a puff, and no threshold below may be used to. If a
 * future feature would prompt *toward* smoking, it does not belong here.
 */
export const SESSION_CONFIG = {
  /** Coals are usually spent around here — the cat gets your attention. */
  coalsMinutes: 35,
  /** Gentle stand-up / drink-water reminder on this cadence. */
  breakReminderMinutes: 25,
  /** A long session. The cat gets sleepy, and so, probably, should you. */
  sleepyAfterMinutes: 90,
  /** More than `puffLimit` puffs inside this window counts as going too fast. */
  puffWindowSeconds: 120,
  puffLimit: 3,
  /** How long a nudge or reminder stays on screen. */
  noticeSeconds: 8,
} as const;

/**
 * A mascot one-shot clip runs ~5s. Transient states clear a little after that.
 *
 * We can't rely on the video's 'ended' event alone: if a higher-priority state
 * (a spent bowl) preempts a one-shot mid-play, the clip never finishes and 'ended'
 * never fires — the state would be stuck on forever. This timeout is the safety net.
 */
export const ONE_SHOT_MS = 5400;

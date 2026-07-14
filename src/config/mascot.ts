import { assetUrl } from './assets';

// Every animation the cat can play. Each name maps 1:1 to a pair of files in the S3
// bucket (mascot/<state>.webm and mascot/<state>.mov), so the union and the filenames
// must stay in sync.
export type MascotState =
  | 'idle'
  | 'idle-variant'
  | 'greeting'
  | 'goodbye'
  | 'thinking'
  | 'talking'
  | 'happy'
  | 'alert'
  | 'easy-there'
  | 'sleepy'
  | 'smoking';

export const ALL_MASCOT_STATES: readonly MascotState[] = [
  'idle',
  'idle-variant',
  'greeting',
  'goodbye',
  'thinking',
  'talking',
  'happy',
  'alert',
  'easy-there',
  'sleepy',
  'smoking',
];

// Only these get warmed on load. The rest (goodbye, smoking, alert, easy-there,
// sleepy) are triggered by timers or a session ending, so there is plenty of time to
// fetch them on demand — preloading all 11 costs ~5.6MB and buys nothing.
export const PRELOAD_STATES: readonly MascotState[] = [
  'idle',
  'idle-variant',
  'greeting',
  'thinking',
  'happy',
];

// LOOPING states play until something changes them — the cat is "in" that state and
// stays there (still thinking, still nagging you about the coals).
//
// Note the two idles are deliberately NOT looping. Letting each idle clip END means we
// get an 'ended' event, which is our cue to swap to the other idle — that alternation
// is what stops a resting cat from looking like a GIF stuck on repeat.
const LOOPING: ReadonlySet<MascotState> = new Set<MascotState>([
  'thinking',
  'talking',
  'alert',
  'sleepy',
  'smoking',
]);

export function isLooping(state: MascotState): boolean {
  return LOOPING.has(state);
}

// The clips are TRANSPARENT video, and no single format works everywhere:
//   .mov  HEVC + alpha -> Safari / iOS (cannot do alpha in WebM)
//   .webm VP9 + alpha  -> Chrome, Firefox, Edge
// Both are listed as <source>s, .mov first, so Safari takes it and everyone else
// falls through to the WebM.
export function mascotSources(state: MascotState): { mov: string; webm: string } {
  return {
    mov: assetUrl(`mascot/${state}.mov`),
    webm: assetUrl(`mascot/${state}.webm`),
  };
}

// Two idle clips exist purely so the resting cat doesn't loop identically forever.
export function randomIdle(): MascotState {
  return Math.random() < 0.5 ? 'idle' : 'idle-variant';
}

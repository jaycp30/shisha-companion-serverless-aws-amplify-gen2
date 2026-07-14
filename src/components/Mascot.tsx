import { useEffect } from 'react';
import {
  isLooping,
  mascotSources,
  PRELOAD_STATES,
  type MascotState,
} from '../config/mascot';

interface MascotProps {
  state: MascotState;
  /** Fires when a non-looping clip finishes. The parent decides what plays next. */
  onClipEnd: () => void;
  /** Tapping the cat logs a puff. */
  onTap: () => void;
}

/**
 * The cat. Deliberately dumb in two ways:
 *
 *  - It plays exactly the state it is given and reports when a clip finishes. It used
 *    to decay one-shots back to idle itself, which broke once timers existed: a 'happy'
 *    clip ending while the coals are spent must return to 'alert', and only the parent
 *    knows that. Priority lives in one chain in App.
 *  - It does not position itself. MascotDock owns placement, so the cat, its speech
 *    bubble, and the chat button can move as one unit.
 */
export function Mascot({ state, onClipEnd, onTap }: MascotProps) {
  // Warm the HTTP cache for clips we'll likely need soon, so a state change swaps
  // instantly instead of freezing while a clip downloads.
  //
  // fetch() rather than detached <video preload="auto"> elements on purpose: a video
  // element holds a DECODER, and several idling in the background is real memory and
  // CPU that shows up as scroll jank. A fetch fills the HTTP cache and lets the bytes
  // go. (The S3 bucket allows CORS GET, which fetch requires.)
  useEffect(() => {
    for (const preloadState of PRELOAD_STATES) {
      void fetch(mascotSources(preloadState).webm).catch(() => {
        // A failed warm-up isn't an error — the clip will just load on demand.
      });
    }
  }, []);

  const sources = mascotSources(state);

  return (
    <button type="button" onClick={onTap} aria-label="Log a puff" className="w-full cursor-pointer">
      {/* key={state} remounts the element on a state change. A <video> with <source>
          children does not swap clips when the children change — remounting forces it,
          and autoPlay then starts the new clip. */}
      <video
        key={state}
        className="w-full drop-shadow-[0_6px_10px_rgba(62,39,35,0.22)]"
        autoPlay
        muted
        playsInline
        loop={isLooping(state)}
        onEnded={onClipEnd}
        aria-hidden="true"
      >
        <source src={sources.mov} type='video/quicktime; codecs="hvc1"' />
        <source src={sources.webm} type="video/webm" />
      </video>
    </button>
  );
}

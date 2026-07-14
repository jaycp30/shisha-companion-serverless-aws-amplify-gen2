import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { MOODS, MOOD_ORDER, type Mood } from '../config/audio';
import { BackgroundVideo } from './BackgroundVideo';

interface SplashProps {
  onStart: (mood: Mood, muted: boolean) => void;
}

/**
 * The title screen.
 *
 * This exists for a HARD technical reason, not just for game-feel: browsers refuse to
 * play audio until the user has interacted with the page. Without a click to hang the
 * unlock on, the BGM would simply never start. So the "Start Session" button is the
 * gesture — and we let it double as a chance to pick a mood before the music begins.
 */
export function Splash({ onStart }: SplashProps) {
  const [mood, setMood] = useState<Mood>('cozy');
  const [muted, setMuted] = useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-6 text-espresso">
      <BackgroundVideo scene="lounge-hero" />

      <motion.div
        className="w-full max-w-md rounded-3xl border border-petal bg-cream/95 p-8 text-center backdrop-blur-sm"
        initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="text-4xl font-semibold tracking-tight">Shisha Companion</h1>
        <p className="mt-3 leading-relaxed text-espresso-soft">
          Snap a menu, get flavor picks, and hang out with your session buddy.
        </p>

        <fieldset className="mt-8">
          <legend className="mb-3 text-[10px] font-medium uppercase tracking-widest text-espresso-soft">
            Mood
          </legend>
          <div className="flex gap-2">
            {MOOD_ORDER.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMood(option)}
                aria-pressed={mood === option}
                className={`flex-1 rounded-full border px-3 py-2 text-sm font-medium transition ${
                  mood === option
                    ? 'border-petal bg-petal text-espresso'
                    : 'border-petal bg-linen text-espresso-soft hover:bg-petal-soft'
                }`}
              >
                {MOODS[option].label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-5 flex cursor-pointer items-center justify-center gap-2 text-sm text-espresso-soft">
          <input
            type="checkbox"
            checked={muted}
            onChange={(event) => setMuted(event.target.checked)}
            className="accent-petal"
          />
          Start muted
        </label>

        <button
          type="button"
          onClick={() => onStart(mood, muted)}
          className="mt-7 w-full rounded-full bg-petal px-6 py-3.5 font-semibold text-espresso transition hover:brightness-95"
        >
          Start session 🐾
        </button>
      </motion.div>
    </div>
  );
}

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type RefObject } from 'react';
import type { FlavorPick } from '../types/menu';

interface StickyPicksProps {
  picks: FlavorPick[];
  /** The full-size picks section. The condensed bar appears once this scrolls away. */
  watchRef: RefObject<HTMLElement | null>;
}

/**
 * A condensed HUD of the top picks that rides along once the full cards have scrolled
 * out of view, so you never lose them while reading mixes and pairings.
 *
 * Why this rather than making the cards themselves `position: sticky`: sticky only pins
 * an element SHORTER than the viewport. The pick cards are roughly viewport-height on
 * desktop and taller on mobile, so sticky would barely pin on a laptop and do nothing
 * at all on a phone. Collapsing to a slim bar sidesteps the height problem entirely.
 */
export function StickyPicks({ picks, watchRef }: StickyPicksProps) {
  const [show, setShow] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const element = watchRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show only when the cards have scrolled ABOVE the viewport — not while we're
        // still on our way down to them (where they're also "not intersecting").
        setShow(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [watchRef]);

  // There can now be up to 7 picks, which would overflow a one-line bar. The first
  // three are always Best / Safer / Stronger — the ones worth keeping in front of you.
  const headline = picks.slice(0, 3);
  const extra = picks.length - headline.length;

  return (
    <AnimatePresence>
      {show && (
        <motion.aside
          // top-1 clears the 4px scroll-progress bar.
          className="fixed inset-x-0 top-1 z-40 px-4"
          initial={reduceMotion ? false : { y: -64, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? undefined : { y: -64, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          aria-label="Your picks"
        >
          <div className="mx-auto flex max-w-3xl flex-wrap items-baseline gap-x-6 gap-y-1 rounded-b-2xl border border-petal bg-cream/95 px-5 py-2.5 backdrop-blur-sm">
            {headline.map((pick, index) => (
              <span key={pick.name} className="flex items-baseline gap-2 text-sm">
                <span
                  className={`text-[10px] font-medium uppercase tracking-widest ${
                    index === 0 ? 'text-espresso' : 'text-espresso-soft'
                  }`}
                >
                  {pick.label}
                </span>
                <span className={index === 0 ? 'font-semibold' : ''}>{pick.name}</span>
              </span>
            ))}

            {extra > 0 && (
              <span className="text-xs text-espresso-soft">+{extra} more</span>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

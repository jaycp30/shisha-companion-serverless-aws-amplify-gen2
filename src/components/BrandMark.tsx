import { useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

// Scroll distance over which the hero title hands off to this docked one. Roughly the
// height of the header block, so the swap lands as the big title leaves the viewport.
const DOCK_AFTER_PX = 170;
// Don't start until the hero is already on its way out, or the two overlap visibly.
const DOCK_START_PX = 70;

/**
 * The small "Shisha Companion" that docks into the top-left control row once the hero
 * title has scrolled away, so the app is still named no matter how far down you are.
 *
 * It animates its own WIDTH (not just opacity) because it lives in a flex row next to
 * the zen and curator controls: growing from zero pushes them right as it arrives,
 * instead of leaving a permanent gap in the corner while it is invisible.
 *
 * Presentational on purpose — `aria-hidden` with the real <h1> left in the content
 * column. Two <h1>s saying the same thing would be a screen-reader nuisance and an SEO
 * own-goal; this is decoration for sighted scrollers.
 */
export function BrandMark() {
  const reduceMotion = useReducedMotion();
  const textRef = useRef<HTMLSpanElement>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const { scrollY } = useScroll();

  // Measure the text's natural width so the animation has a real target to grow to.
  // Re-measured on resize: font metrics shift with viewport and zoom.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = (): void => setNaturalWidth(el.scrollWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const width = useTransform(scrollY, [DOCK_START_PX, DOCK_AFTER_PX], [0, naturalWidth]);
  const opacity = useTransform(scrollY, [DOCK_START_PX, DOCK_AFTER_PX], [0, 1]);

  // A title that slides and resizes as you scroll is exactly the kind of motion this
  // setting exists to suppress. It's purely decorative — the hero <h1> still names the
  // app — so the honest response is to not render it at all rather than fake a subtler
  // version of the same effect.
  if (reduceMotion) return null;

  // Hidden below `sm`: a phone's top bar cannot hold the brand, the zen and curator
  // controls, AND the audio pill — at 375px this row overlapped the pill by ~46px.
  // Something had to give, and this is the only decorative one of the three; the real
  // <h1> still names the app in the content column.
  return (
    <motion.div
      style={{ width, opacity }}
      className="hidden overflow-hidden sm:block"
      aria-hidden="true"
    >
      <span
        ref={textRef}
        className="control-halo block whitespace-nowrap pr-3 text-xs font-semibold tracking-wide text-espresso"
      >
        Shisha Companion
      </span>
    </motion.div>
  );
}

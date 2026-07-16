import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

// Must line up with BrandMark's dock window: the hero fades out over the same scroll
// distance the docked mark fades in, so exactly one of them reads at any moment.
const FADE_START_PX = 40;
const FADE_END_PX = 150;

/**
 * The big title at the top of the content column, and the app's real <h1>.
 *
 * It dims and lifts slightly as it scrolls away, handing off to the small BrandMark that
 * docks in the top-left row. Keeping the <h1> here rather than in the docked mark means
 * the heading stays in the document where the content is, not stranded in a fixed
 * overlay — the docked copy is decorative and aria-hidden.
 */
export function HeroTitle() {
  const reduceMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [FADE_START_PX, FADE_END_PX], [1, 0]);
  const y = useTransform(scrollY, [FADE_START_PX, FADE_END_PX], [0, -12]);

  // With reduced motion there is no docked mark to hand off to (BrandMark opts out
  // entirely), so the hero must stay put and fully legible — fading it would leave the
  // page with no visible title at all.
  if (reduceMotion) {
    return (
      <header className="mb-10">
        <h1 className="text-5xl font-semibold tracking-tight">Shisha Companion</h1>
        <p className="mt-3 text-lg text-espresso-soft">
          Snap a menu, get flavor picks, and hang out with your session buddy.
        </p>
      </header>
    );
  }

  return (
    <motion.header className="mb-10" style={{ opacity, y }}>
      <h1 className="text-5xl font-semibold tracking-tight">Shisha Companion</h1>
      <p className="mt-3 text-lg text-espresso-soft">
        Snap a menu, get flavor picks, and hang out with your session buddy.
      </p>
    </motion.header>
  );
}

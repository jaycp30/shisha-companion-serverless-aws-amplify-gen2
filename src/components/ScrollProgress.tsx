import { motion, useScroll, useSpring } from 'motion/react';

/**
 * A thin bar across the top of the page showing how far down the results you are.
 *
 * The raw scroll value is sprung before it drives the bar — without that, the bar
 * snaps frame-to-frame with the scroll wheel and feels twitchy rather than smooth.
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    mass: 0.3,
  });

  return (
    <motion.div
      className="fixed inset-x-0 top-0 z-40 h-1 origin-left bg-petal"
      style={{ scaleX }}
      aria-hidden="true"
    />
  );
}

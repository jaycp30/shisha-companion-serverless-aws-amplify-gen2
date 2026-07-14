import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  /** Seconds to wait before animating — used to stagger siblings. */
  delay?: number;
  className?: string;
}

/**
 * Fades and lifts its children into place the first time they scroll into view.
 *
 * `viewport.once` means it animates a single time, not every time you scroll past —
 * repeatedly re-animating content you've already read is distracting, not delightful.
 */
export function Reveal({ children, delay = 0, className = '' }: RevealProps) {
  const reduceMotion = useReducedMotion();

  // Some people get motion sick, and the OS-level setting is how they say so.
  // Render plainly instead of animating — never override that preference.
  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

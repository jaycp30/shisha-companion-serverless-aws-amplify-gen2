import { motion, useMotionValue, useSpring, type SpringOptions } from 'motion/react';
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';

/**
 * 3D tilt-on-hover wrapper.
 *
 * Adapted from React Bits' TiltedCard (https://reactbits.dev) — Copyright (c) 2026
 * David Haz, MIT + Commons Clause. Used here as part of an application, which the
 * licence permits; the component itself is not resold or redistributed.
 *
 * Changes from the original:
 *  - The original is built around an <img> plus a floating tooltip and a literal
 *    "not optimized for mobile" banner. Ours wraps arbitrary children (our text
 *    cards) and drops both.
 *  - Subtler motion: 8deg of rotation instead of 14, and a 1.03 hover scale instead
 *    of 1.1, to suit a minimalist editorial layout rather than a showcase demo.
 *  - No mobile special-casing needed: touch devices have no hover, so the card simply
 *    stays flat — which is the correct degradation, not a bug.
 */

const SPRING: SpringOptions = { damping: 30, stiffness: 100, mass: 2 };

interface TiltCardProps {
  children: ReactNode;
  /**
   * Max rotation in degrees. Keep this LOW on wide cards — the same angle that reads
   * as a pleasant tilt on a narrow card looks like the card is flapping when it's
   * 700px across.
   */
  amplitudeDeg?: number;
  scaleOnHover?: number;
  className?: string;
}

export function TiltCard({
  children,
  amplitudeDeg = 8,
  scaleOnHover = 1.03,
  className = '',
}: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Motion values are sprung so the card eases into place instead of snapping.
  const rotateX = useSpring(useMotionValue(0), SPRING);
  const rotateY = useSpring(useMotionValue(0), SPRING);
  const scale = useSpring(1, SPRING);

  // `will-change: transform` promotes an element to its own compositor layer. Leaving
  // it on permanently means every card on the page holds a layer forever, for an
  // effect that only happens on hover — that costs memory and makes scrolling janky.
  // So we only set it while the pointer is actually over this card.
  const [hovering, setHovering] = useState(false);

  function handleMouseMove(event: MouseEvent<HTMLDivElement>): void {
    const element = ref.current;
    if (!element) return;

    // Rotation is driven by how far the pointer sits from the card's centre.
    const rect = element.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - rect.width / 2;
    const offsetY = event.clientY - rect.top - rect.height / 2;

    rotateX.set((offsetY / (rect.height / 2)) * -amplitudeDeg);
    rotateY.set((offsetX / (rect.width / 2)) * amplitudeDeg);
  }

  function handleMouseEnter(): void {
    setHovering(true);
    scale.set(scaleOnHover);
  }

  function handleMouseLeave(): void {
    setHovering(false);
    rotateX.set(0);
    rotateY.set(0);
    scale.set(1);
  }

  return (
    <div
      ref={ref}
      className={`[perspective:900px] ${className}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        className={`h-full [transform-style:preserve-3d] ${
          hovering ? 'will-change-transform' : ''
        }`}
        style={{ rotateX, rotateY, scale }}
      >
        {children}
      </motion.div>
    </div>
  );
}

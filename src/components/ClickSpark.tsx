import { useCallback, useEffect, useRef } from 'react';

/**
 * Click spark effect.
 *
 * Adapted from React Bits (https://reactbits.dev) — Copyright (c) 2026 David Haz,
 * MIT + Commons Clause. Used here as part of an application, which the licence
 * permits; the component itself is not resold or redistributed.
 *
 * Changes from the original:
 *  - The rAF loop IDLES when no sparks are alive. The original ran every frame
 *    forever; this app already decodes two videos (background + alpha mascot), so a
 *    permanently-running animation loop is cost we can't justify.
 *  - The canvas is fixed to the viewport rather than sized to a wrapper element, so a
 *    long scrolling page doesn't allocate a canvas the height of the whole document.
 *  - Listens on the window, so a click anywhere sparks — including taps, which is why
 *    this works on mobile where a cursor effect would do nothing.
 */

interface Spark {
  x: number;
  y: number;
  angle: number;
  startTime: number;
}

interface ClickSparkProps {
  sparkColor?: string;
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  durationMs?: number;
}

export function ClickSpark({
  sparkColor = '#3e2723', // espresso
  sparkSize = 10,
  sparkRadius = 18,
  sparkCount = 8,
  durationMs = 400,
}: ClickSparkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparks = useRef<Spark[]>([]);
  const frame = useRef<number | null>(null);

  const draw = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      sparks.current = sparks.current.filter((spark) => {
        const elapsed = timestamp - spark.startTime;
        if (elapsed >= durationMs) return false;

        const progress = elapsed / durationMs;
        const eased = progress * (2 - progress); // ease-out

        // Each spark is a short line flying outward from the click point, shrinking
        // as it goes.
        const distance = eased * sparkRadius;
        const lineLength = sparkSize * (1 - eased);

        ctx.strokeStyle = sparkColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(
          spark.x + distance * Math.cos(spark.angle),
          spark.y + distance * Math.sin(spark.angle),
        );
        ctx.lineTo(
          spark.x + (distance + lineLength) * Math.cos(spark.angle),
          spark.y + (distance + lineLength) * Math.sin(spark.angle),
        );
        ctx.stroke();

        return true;
      });

      if (sparks.current.length > 0) {
        frame.current = requestAnimationFrame(draw);
      } else {
        // Nothing left to animate — stop the loop entirely until the next click.
        frame.current = null;
      }
    },
    [durationMs, sparkColor, sparkRadius, sparkSize],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = (): void => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();

    const handleClick = (event: MouseEvent): void => {
      const now = performance.now();
      for (let i = 0; i < sparkCount; i += 1) {
        sparks.current.push({
          x: event.clientX,
          y: event.clientY,
          angle: (2 * Math.PI * i) / sparkCount,
          startTime: now,
        });
      }
      // Only kick the loop if it is currently idle.
      if (frame.current === null) {
        frame.current = requestAnimationFrame(draw);
      }
    };

    window.addEventListener('resize', resize);
    window.addEventListener('click', handleClick);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('click', handleClick);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [draw, sparkCount]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50"
      aria-hidden="true"
    />
  );
}

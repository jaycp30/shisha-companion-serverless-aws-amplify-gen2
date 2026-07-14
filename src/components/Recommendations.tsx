import { useRef } from 'react';
import { Reveal } from './Reveal';
import { StickyPicks } from './StickyPicks';
import { TiltCard } from './TiltCard';
import type { FlavorPick, MenuAnalysis } from '../types/menu';

interface RecommendationsProps {
  analysis: MenuAnalysis;
}

// Each item reveals slightly after the one before it, so a section unfolds instead of
// popping in all at once.
const STAGGER_SECONDS = 0.08;

/** Must match the `gap-4` on the carousel row (Tailwind's gap-4 = 1rem = 16px). */
const GAP_PX = 16;

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-espresso-soft">
      {children}
    </h2>
  );
}

// The wide cards (mixes, pairings, skips) tilt too, but far more gently than the narrow
// pick cards — a big surface exaggerates the same angle.
function Card({ children }: { children: React.ReactNode }) {
  return (
    <TiltCard amplitudeDeg={4} scaleOnHover={1.01}>
      <div className="rounded-2xl border border-petal bg-cream p-6">{children}</div>
    </TiltCard>
  );
}

function PickCard({ pick, featured = false }: { pick: FlavorPick; featured?: boolean }) {
  return (
    <TiltCard className="h-full">
      <div
        className={`h-full rounded-2xl border p-6 ${
          featured ? 'border-petal bg-petal-soft' : 'border-petal bg-cream'
        }`}
      >
        <p className="text-xs font-medium uppercase tracking-widest text-espresso-soft">
          {pick.label}
        </p>
        <p className="mt-2 text-lg font-semibold">{pick.name}</p>
        <p className="mt-2 text-sm leading-relaxed text-espresso-soft">{pick.why}</p>
      </div>
    </TiltCard>
  );
}

export function Recommendations({ analysis }: RecommendationsProps) {
  const { picks, mixes, drink_pairings, avoid, session_notes } = analysis;

  // Watched by StickyPicks: once these cards scroll away, the condensed bar appears.
  const picksRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Scroll exactly one card, measured from the DOM rather than hardcoded — the card
  // width changes at the sm: breakpoint, and a hardcoded number would drift out of
  // sync with the class the moment either is edited.
  function scrollByCard(direction: 1 | -1): void {
    const row = rowRef.current;
    if (!row) return;
    const card = row.firstElementChild as HTMLElement | null;
    const step = card ? card.offsetWidth + GAP_PX : row.clientWidth * 0.8;
    row.scrollBy({ left: direction * step, behavior: 'smooth' });
  }

  return (
    <div className="space-y-12">
      <StickyPicks picks={picks} watchRef={picksRef} />

      <section ref={picksRef}>
        <Reveal>
          <div className="mb-4 flex items-center justify-between">
            <SectionTitle>Your picks</SectionTitle>

            {/* A mouse wheel only emits VERTICAL delta, so an overflow-x row never
                receives it — trackpads send horizontal gestures, a mouse does not.
                Without these buttons, mouse users simply cannot scroll the row.
                (Deliberately not remapping wheel-Y to scroll-X: that would stop the
                PAGE scrolling whenever the cursor happened to be over the carousel.) */}
            <div className="-mt-4 flex gap-1">
              <button
                type="button"
                onClick={() => scrollByCard(-1)}
                aria-label="Previous picks"
                className="rounded-full border border-petal bg-cream px-3 py-1 text-espresso transition hover:bg-petal-soft"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => scrollByCard(1)}
                aria-label="More picks"
                className="rounded-full border border-petal bg-cream px-3 py-1 text-espresso transition hover:bg-petal-soft"
              >
                ›
              </button>
            </div>
          </div>
        </Reveal>

        {/*
          A native scroll-snap row rather than a JS carousel: real touch momentum on
          mobile, zero dependencies, and it handles our variable-height text cards
          without fighting the TiltCard hover.

          tabIndex makes it focusable, which is what lets arrow KEYS scroll it too.

          The negative margin + matching padding let the row bleed to the container's
          edges so the next card PEEKS in — that peek is what says "there's more".
        */}
        <div
          ref={rowRef}
          tabIndex={0}
          role="group"
          aria-label="Flavor picks, scrollable"
          className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {picks.map((pick, index) => (
            <Reveal
              key={pick.name}
              delay={index * STAGGER_SECONDS}
              className="w-64 shrink-0 snap-start sm:w-72"
            >
              {/* Index 0 is always "Best" — the model is told to return it first. */}
              <PickCard pick={pick} featured={index === 0} />
            </Reveal>
          ))}
        </div>
      </section>

      {mixes.length > 0 && (
        <section>
          <Reveal>
            <SectionTitle>Mixes worth trying</SectionTitle>
          </Reveal>
          <div className="space-y-3">
            {mixes.map((mix, index) => (
              <Reveal key={mix.components.join('+')} delay={index * STAGGER_SECONDS}>
                <Card>
                  <p className="font-semibold">{mix.components.join(' + ')}</p>
                  <p className="mt-2 text-sm leading-relaxed text-espresso-soft">
                    {mix.why}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {drink_pairings.length > 0 && (
        <section>
          <Reveal>
            <SectionTitle>Drink pairings</SectionTitle>
          </Reveal>
          <div className="space-y-3">
            {drink_pairings.map((pairing, index) => (
              <Reveal
                key={`${pairing.pick}-${pairing.drink}`}
                delay={index * STAGGER_SECONDS}
              >
                <Card>
                  <p className="font-semibold">
                    {pairing.pick} <span className="text-espresso-soft">with</span>{' '}
                    {pairing.drink}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-espresso-soft">
                    {pairing.why}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {avoid.length > 0 && (
        <section>
          <Reveal>
            <SectionTitle>Maybe skip</SectionTitle>
          </Reveal>
          <div className="space-y-3">
            {avoid.map((item, index) => (
              <Reveal key={item.name} delay={index * STAGGER_SECONDS}>
                <Card>
                  <p className="font-semibold">{item.name}</p>
                  <p className="mt-2 text-sm leading-relaxed text-espresso-soft">
                    {item.why}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      <section>
        <Reveal>
          <SectionTitle>Session notes</SectionTitle>
          <Card>
            <p className="leading-relaxed">{session_notes}</p>
          </Card>
        </Reveal>
      </section>
    </div>
  );
}

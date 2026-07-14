import type { FlavorPick, MenuAnalysis } from '../types/menu';

interface RecommendationsProps {
  analysis: MenuAnalysis;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-espresso-soft">
      {children}
    </h2>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-petal bg-cream p-6">{children}</div>;
}

interface PickCardProps {
  label: string;
  pick: FlavorPick;
  featured?: boolean;
}

function PickCard({ label, pick, featured = false }: PickCardProps) {
  return (
    <div
      className={`rounded-2xl border p-6 ${
        featured ? 'border-petal bg-petal-soft' : 'border-petal bg-cream'
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-widest text-espresso-soft">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold">{pick.name}</p>
      <p className="mt-2 text-sm leading-relaxed text-espresso-soft">{pick.why}</p>
    </div>
  );
}

export function Recommendations({ analysis }: RecommendationsProps) {
  const { picks, mixes, drink_pairings, avoid, session_notes } = analysis;

  return (
    <div className="space-y-10">
      <section>
        <SectionTitle>Your picks</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <PickCard label="Best" pick={picks.best} featured />
          <PickCard label="Safer" pick={picks.safer} />
          <PickCard label="Stronger" pick={picks.stronger} />
        </div>
      </section>

      {mixes.length > 0 && (
        <section>
          <SectionTitle>Mixes worth trying</SectionTitle>
          <div className="space-y-3">
            {mixes.map((mix) => (
              <Card key={mix.components.join('+')}>
                <p className="font-semibold">{mix.components.join(' + ')}</p>
                <p className="mt-2 text-sm leading-relaxed text-espresso-soft">{mix.why}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {drink_pairings.length > 0 && (
        <section>
          <SectionTitle>Drink pairings</SectionTitle>
          <div className="space-y-3">
            {drink_pairings.map((pairing) => (
              <Card key={`${pairing.pick}-${pairing.drink}`}>
                <p className="font-semibold">
                  {pairing.pick} <span className="text-espresso-soft">with</span> {pairing.drink}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-espresso-soft">{pairing.why}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {avoid.length > 0 && (
        <section>
          <SectionTitle>Maybe skip</SectionTitle>
          <div className="space-y-3">
            {avoid.map((item) => (
              <Card key={item.name}>
                <p className="font-semibold">{item.name}</p>
                <p className="mt-2 text-sm leading-relaxed text-espresso-soft">{item.why}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Session notes</SectionTitle>
        <Card>
          <p className="leading-relaxed">{session_notes}</p>
        </Card>
      </section>
    </div>
  );
}

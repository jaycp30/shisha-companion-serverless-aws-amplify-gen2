import { useState, type FormEvent } from 'react';
import {
  findNearbyCafes,
  geocodeCity,
  getBrowserLocation,
  mapsLink,
  NearbyError,
  suggestLounge,
  SUGGEST_NEAR_KM,
  type Cafe,
  type GeoPoint,
} from '../lib/nearbyCafes';

// Collapsed by default so the upload card stays the clear primary action — this is a
// "while you're here" extra, not the main flow.
export function NearbyCafes() {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState<GeoPoint | null>(null);
  const [results, setResults] = useState<Cafe[] | null>(null);

  // "Suggest this lounge to OpenStreetMap" flow.
  const [suggestName, setSuggestName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [suggestError, setSuggestError] = useState('');

  function resetSuggest(): void {
    setSuggestName('');
    setConfirming(false);
    setSuggesting(false);
    setSuggested(false);
    setSuggestError('');
  }

  async function runSearch(getOrigin: () => Promise<GeoPoint>): Promise<void> {
    setBusy(true);
    setError('');
    setResults(null);
    resetSuggest();
    try {
      const point = await getOrigin();
      setOrigin(point);
      setResults(await findNearbyCafes(point));
    } catch (err) {
      setError(
        err instanceof NearbyError
          ? err.message
          : 'Something went wrong searching — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function handleCitySearch(event: FormEvent): void {
    event.preventDefault();
    const query = city.trim();
    if (!query || busy) return;
    void runSearch(() => geocodeCity(query));
  }

  async function handleSuggest(): Promise<void> {
    if (!origin) return;
    setSuggesting(true);
    setSuggestError('');
    try {
      await suggestLounge(origin, suggestName);
      setSuggested(true);
      setConfirming(false);
    } catch (err) {
      setSuggestError(
        err instanceof NearbyError ? err.message : "Couldn't submit the suggestion.",
      );
      setConfirming(false);
    } finally {
      setSuggesting(false);
    }
  }

  // Only offer to add a place when the user is physically here (a device fix, not a typed
  // city) and no lounge is already mapped at this spot — otherwise a suggestion is either
  // misplaced or a duplicate.
  const canSuggest =
    results !== null &&
    origin?.source === 'device' &&
    (results.length === 0 || results[0].distanceKm > SUGGEST_NEAR_KM);

  return (
    <section className="rounded-2xl border border-petal bg-cream p-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="font-semibold">Find a shisha lounge nearby 🧭</span>
        <span className="text-espresso-soft" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => !busy && void runSearch(getBrowserLocation)}
              disabled={busy}
              className="rounded-full bg-petal px-5 py-2.5 text-sm font-medium text-espresso transition hover:brightness-95 disabled:opacity-50"
            >
              Use my location
            </button>
            <span className="text-sm text-espresso-soft">or</span>
            <form onSubmit={handleCitySearch} className="flex min-w-0 flex-1 gap-2">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Type a city or district…"
                aria-label="City or district"
                className="min-w-0 flex-1 rounded-full border border-petal bg-linen px-4 py-2.5 text-sm text-espresso outline-none placeholder:text-espresso-soft focus:border-espresso-soft"
              />
              <button
                type="submit"
                disabled={busy || city.trim() === ''}
                className="rounded-full border border-petal px-4 py-2.5 text-sm font-medium text-espresso transition hover:bg-petal-soft disabled:opacity-50"
              >
                Search
              </button>
            </form>
          </div>

          {busy && (
            <p className="mt-4 text-sm text-espresso-soft" role="status">
              Looking for lounges…
            </p>
          )}

          {error && (
            <p className="mt-4 rounded-xl bg-petal-soft px-4 py-3 text-sm" role="alert">
              {error}
            </p>
          )}

          {results && !busy && (
            <div className="mt-5">
              {results.length === 0 ? (
                <p className="text-sm text-espresso-soft">
                  No mapped lounges near {origin?.label} — coverage is community-sourced,
                  so some areas are thin.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-espresso-soft">
                    {results.length} near {origin?.label}:
                  </p>
                  <ul className="space-y-2">
                    {results.map((cafe) => (
                      <li
                        key={cafe.id}
                        className="flex items-baseline justify-between gap-4 rounded-xl border border-petal bg-linen px-4 py-3"
                      >
                        <a
                          href={mapsLink(cafe)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-espresso underline-offset-2 hover:underline"
                        >
                          {cafe.name}
                        </a>
                        <span className="whitespace-nowrap text-xs text-espresso-soft">
                          {cafe.distanceKm.toFixed(1)} km
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-espresso-soft">
                    Data © OpenStreetMap contributors
                  </p>
                </>
              )}

              {/* Give back to the map you just used — but only when it makes sense, and
                  never without an explicit confirm (it posts to public OpenStreetMap). */}
              {canSuggest && (
                <div className="mt-5 rounded-xl border border-dashed border-petal p-4">
                  {suggested ? (
                    <p className="text-sm text-espresso-soft" role="status">
                      Thanks! 🐾 Your suggestion was sent to OpenStreetMap — a mapper will
                      review it before it appears.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-medium">Here but not on the map?</p>
                      <p className="mt-1 text-xs text-espresso-soft">
                        Suggest this lounge to OpenStreetMap — it&apos;s reviewed by a real
                        mapper before it lands.
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <input
                          value={suggestName}
                          onChange={(e) => {
                            setSuggestName(e.target.value);
                            setConfirming(false);
                          }}
                          placeholder="Lounge name"
                          aria-label="Lounge name"
                          disabled={suggesting}
                          className="min-w-0 flex-1 rounded-full border border-petal bg-linen px-4 py-2 text-sm text-espresso outline-none placeholder:text-espresso-soft focus:border-espresso-soft"
                        />
                        {!confirming && (
                          <button
                            type="button"
                            onClick={() => setConfirming(true)}
                            disabled={suggesting || suggestName.trim() === ''}
                            className="rounded-full border border-petal px-4 py-2 text-sm font-medium text-espresso transition hover:bg-petal-soft disabled:opacity-50"
                          >
                            Suggest it
                          </button>
                        )}
                      </div>

                      {confirming && (
                        <div className="mt-3">
                          <p className="text-xs text-espresso-soft">
                            Post <span className="font-medium">{suggestName.trim()}</span> at
                            your current location as a public suggestion to OpenStreetMap?
                          </p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void handleSuggest()}
                              disabled={suggesting}
                              className="rounded-full bg-petal px-4 py-2 text-sm font-medium text-espresso transition hover:brightness-95 disabled:opacity-50"
                            >
                              {suggesting ? 'Sending…' : 'Yes, submit'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirming(false)}
                              disabled={suggesting}
                              className="rounded-full px-4 py-2 text-sm text-espresso-soft transition hover:bg-petal-soft disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {suggestError && (
                        <p className="mt-3 text-sm text-espresso" role="alert">
                          {suggestError}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

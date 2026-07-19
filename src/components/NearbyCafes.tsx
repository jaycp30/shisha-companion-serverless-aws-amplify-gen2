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
import {
  searchLoungesOnWeb,
  LoungeSearchError,
  type WebLounge,
} from '../lib/loungeWebSearch';

interface NearbyCafesProps {
  /** Only signed-in curators may push suggestions to public OpenStreetMap. */
  isCurator: boolean;
}

// Collapsed by default so the upload card stays the clear primary action — this is a
// "while you're here" extra, not the main flow.
export function NearbyCafes({ isCurator }: NearbyCafesProps) {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState<GeoPoint | null>(null);
  const [results, setResults] = useState<Cafe[] | null>(null);

  // The paid "search the web" escalation (Claude Platform + hosted web search). Kept
  // separate from the free OSM state so a web search never disturbs the map results.
  const [webBusy, setWebBusy] = useState(false);
  const [webError, setWebError] = useState('');
  const [webResults, setWebResults] = useState<WebLounge[] | null>(null);

  // "Suggest this lounge to OpenStreetMap" flow.
  const [suggestName, setSuggestName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  // Link to the filed note, so the curator can track it — or map it and close it
  // themselves. Null when OSM's response didn't give us an id; the note still posted.
  const [suggestedUrl, setSuggestedUrl] = useState<string | null>(null);

  function resetSuggest(): void {
    setSuggestName('');
    setConfirming(false);
    setSuggesting(false);
    setSuggested(false);
    setSuggestError('');
    setSuggestedUrl(null);
  }

  function resetWebSearch(): void {
    setWebBusy(false);
    setWebError('');
    setWebResults(null);
  }

  async function runSearch(getOrigin: () => Promise<GeoPoint>): Promise<void> {
    setBusy(true);
    setError('');
    setResults(null);
    resetSuggest();
    resetWebSearch();
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

  async function handleWebSearch(): Promise<void> {
    if (!origin || webBusy) return;
    setWebBusy(true);
    setWebError('');
    setWebResults(null);
    try {
      setWebResults(await searchLoungesOnWeb(origin));
    } catch (err) {
      setWebError(
        err instanceof LoungeSearchError
          ? err.message
          : 'The web search ran into a problem — try again.',
      );
    } finally {
      setWebBusy(false);
    }
  }

  async function handleSuggest(): Promise<void> {
    if (!origin) return;
    setSuggesting(true);
    setSuggestError('');
    try {
      const note = await suggestLounge(origin, suggestName);
      setSuggestedUrl(note.url);
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

  // Only offer to add a place when a signed-in curator is physically here (a device fix,
  // not a typed city) and no lounge is already mapped at this spot — otherwise a
  // suggestion is either misplaced or a duplicate.
  //
  // The curator gate matters most: this writes to the real public map, and an anonymous
  // button behind a shipped API key is an invitation to spam OpenStreetMap. Public
  // visitors simply never see this box — no "sign in to unlock" nag for a feature that
  // was never meant for them.
  const canSuggest =
    isCurator &&
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

          {/* Gated on `origin`, not `results`: a search that geocoded but whose OSM lounge
              lookup FAILED (Overpass is a flaky free service) still has an origin — and that
              is exactly when the web-search fallback matters most. So this block, and the
              escalation inside it, must survive an OSM error. The OSM list itself is guarded
              separately below on `results`. */}
          {origin && !busy && (
            <div className="mt-5">
              {results && (results.length === 0 ? (
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
              ))}

              {/* Paid web-search escalation. Always offered once a search has run:
                  prominent when the map has nothing to show (empty OR errored), a quiet link
                  when it returned results (web results can still beat patchy OSM data).
                  Costs money + ~a minute, so the copy says so and it never fires without an
                  explicit click. */}
              {webResults === null && !webBusy && (
                <div className="mt-4">
                  {!results || results.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => void handleWebSearch()}
                      className="rounded-full bg-petal px-5 py-2.5 text-sm font-medium text-espresso transition hover:brightness-95"
                    >
                      Nothing on the map — search the web 🔎
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleWebSearch()}
                      className="text-sm text-espresso-soft underline underline-offset-2 transition hover:text-espresso"
                    >
                      Not seeing your spot? Search the web →
                    </button>
                  )}
                  <p className="mt-2 text-xs text-espresso-soft">
                    The cat searches the web with AI — takes about a minute.
                  </p>
                </div>
              )}

              {webBusy && (
                <p className="mt-4 text-sm text-espresso-soft" role="status">
                  Searching the web for lounges near {origin?.label}… this takes about a
                  minute.
                </p>
              )}

              {webError && (
                <p className="mt-4 rounded-xl bg-petal-soft px-4 py-3 text-sm" role="alert">
                  {webError}
                </p>
              )}

              {webResults && !webBusy && (
                <div className="mt-5">
                  {webResults.length === 0 ? (
                    <p className="text-sm text-espresso-soft">
                      The web didn&apos;t turn up any lounges near {origin?.label} either —
                      you may be off the beaten path.
                    </p>
                  ) : (
                    <>
                      <p className="mb-3 text-sm text-espresso-soft">
                        From the web (AI-assisted — double-check hours before you go):
                      </p>
                      <ul className="space-y-2">
                        {webResults.map((lounge, i) => (
                          <li
                            key={`${lounge.name}-${i}`}
                            className="rounded-xl border border-petal bg-linen px-4 py-3"
                          >
                            {lounge.url ? (
                              <a
                                href={lounge.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-espresso underline-offset-2 hover:underline"
                              >
                                {lounge.name}
                              </a>
                            ) : (
                              <span className="text-sm font-medium text-espresso">
                                {lounge.name}
                              </span>
                            )}
                            <p className="mt-0.5 text-xs text-espresso-soft">
                              {lounge.address ? `${lounge.area} · ${lounge.address}` : lounge.area}
                            </p>
                            {lounge.note && (
                              <p className="mt-1 text-xs text-espresso-soft">{lounge.note}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {/* Give back to the map you just used — but only when it makes sense, and
                  never without an explicit confirm (it posts to public OpenStreetMap). */}
              {canSuggest && (
                <div className="mt-5 rounded-xl border border-dashed border-petal p-4">
                  {suggested ? (
                    <div role="status">
                      <p className="text-sm text-espresso-soft">
                        Thanks! 🐾 Your suggestion was sent to OpenStreetMap — a mapper
                        reviews it before it appears.
                      </p>
                      {suggestedUrl && (
                        <a
                          href={suggestedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-xs font-medium text-espresso underline underline-offset-2"
                        >
                          Track your note on OpenStreetMap →
                        </a>
                      )}
                    </div>
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

import { client } from './amplify';
import { getSessionToken } from './sessionToken';
import type { GeoPoint } from './nearbyCafes';

// Client side of the PAID lounge web search — the escalation behind the free OpenStreetMap
// finder in nearbyCafes.ts. When OSM coverage is thin, this asks the backend (Claude
// Platform on AWS + hosted web search) for lounges near a point. It's gated (session token
// + backend rate limits) and slow (30-60s), so it runs as a background job the same way
// menu analysis does: start a job, then poll for the result.

// How long we poll before giving up — a little past the worker's 120s timeout, so a stuck
// job fails cleanly rather than hanging the UI.
const SEARCH_TIMEOUT_MS = 130_000;
// Web search takes 30-60s; a 2s cadence is responsive without hammering the endpoint.
const POLL_INTERVAL_MS = 2000;

// One venue the web search turned up. Mirrors the backend Lounge schema; all but name/area
// are best-effort (a search result may carry neither an address nor a URL).
export interface WebLounge {
  name: string;
  area: string;
  address?: string | null;
  url?: string | null;
  note?: string | null;
}

/** Errors with a message safe to show the user. */
export class LoungeSearchError extends Error {}

// Narrow the polled result JSON to WebLounge[] at the boundary — a bad shape becomes a clean
// error rather than a render crash.
function parseResult(result: unknown): WebLounge[] {
  const parsed: unknown = typeof result === 'string' ? JSON.parse(result) : result;
  if (!Array.isArray(parsed)) {
    throw new LoungeSearchError('Got an unexpected response from the web search.');
  }
  return parsed.filter(
    (item): item is WebLounge =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { name?: unknown }).name === 'string' &&
      typeof (item as { area?: unknown }).area === 'string',
  );
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Search the web for lounges near `origin`. Ensures a session token (may pop the invisible
 * Turnstile check on first use), starts the job, and polls until it resolves.
 *
 * `origin` comes straight from the OSM flow's already-resolved point — a device fix or a
 * geocoded city — so we never re-geocode here.
 */
export async function searchLoungesOnWeb(origin: GeoPoint): Promise<WebLounge[]> {
  let sessionToken: string;
  try {
    sessionToken = await getSessionToken();
  } catch (error) {
    throw new LoungeSearchError(
      error instanceof Error ? error.message : 'Human check failed — please try again.',
    );
  }

  const started = await client.mutations.startLoungeSearch({
    sessionToken,
    lat: origin.lat,
    lon: origin.lon,
    label: origin.label,
  });
  if (started.errors?.length || !started.data) {
    throw new LoungeSearchError(
      started.errors?.[0]?.message ?? "Couldn't start the web search.",
    );
  }

  return pollJob(started.data.jobId, sessionToken);
}

/** Poll the job until DONE (the lounges) or ERROR (throw). Transient errors are retried. */
async function pollJob(jobId: string, sessionToken: string): Promise<WebLounge[]> {
  const deadline = Date.now() + SEARCH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const poll = await client.queries.getLoungeSearchStatus({ jobId, sessionToken });

    if (poll.errors?.length || !poll.data) {
      // Transient — wait and try again rather than failing the whole search.
      await delay(POLL_INTERVAL_MS);
      continue;
    }

    const { status, result, errorMessage } = poll.data;
    if (status === 'DONE') {
      return parseResult(result);
    }
    if (status === 'ERROR') {
      throw new LoungeSearchError(errorMessage ?? "The web search couldn't finish.");
    }
    if (status === 'NOT_FOUND') {
      // We just created (or were handed) this job under our own token — should never be
      // unreadable in a normal flow, so treat it as a hard failure, not a retry.
      throw new LoungeSearchError("That search couldn't be found — please try again.");
    }
    // PENDING / PROCESSING — keep waiting.
    await delay(POLL_INTERVAL_MS);
  }

  throw new LoungeSearchError('The web search took too long — please try again.');
}

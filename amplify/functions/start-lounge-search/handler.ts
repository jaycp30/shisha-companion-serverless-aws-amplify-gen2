import { randomUUID } from 'node:crypto';
import { env } from '$amplify/env/start-lounge-search';
import type { Schema } from '../../data/resource';
import { readSessionToken } from '../session-token';
import {
  createLoungeJob,
  createFinishedLoungeJob,
  findCachedLoungeJob,
} from '../lounge-jobs';
import { locationKey } from '../lounge-search/normalize';

// Jobs are throwaway once read; the row's 24h TTL also bounds how stale a cached result can
// be. A cache hit must be no older than this — long enough to spare repeat searches of the
// same area, short enough that a newly-opened lounge shows up within a day.
const JOB_TTL_SECONDS = 24 * 60 * 60;
const CACHE_MAX_AGE_SECONDS = 24 * 60 * 60;

// Sanity bounds so a malformed client can't create a garbage job.
const LABEL_MAX_LEN = 120;

function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export const handler: Schema['startLoungeSearch']['functionHandler'] = async (event) => {
  const { sessionToken, lat, lon, label } = event.arguments;

  // Proof-of-humanness + session identity comes from the SIGNED token, never an argument.
  const session = readSessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
  if (!session) {
    throw new Error('Session expired — please try again.');
  }

  if (typeof lat !== 'number' || typeof lon !== 'number' || !isValidLatLon(lat, lon)) {
    throw new Error('That location looks off — try again.');
  }
  const cleanLabel = (label ?? '').trim().slice(0, LABEL_MAX_LEN) || 'your area';

  const key = locationKey(lat, lon);
  const table = process.env.LOUNGE_SEARCH_JOBS_TABLE_NAME ?? '';

  const id = randomUUID();

  // Cache check BEFORE paying for a search: if any session recently searched this same grid
  // cell, copy that finished result into a NEW job owned by this session (so the poll's
  // owner check still passes) and return it — zero extra Claude spend. See lounge-jobs.ts.
  const cached = await findCachedLoungeJob(
    table,
    process.env.LOUNGE_SEARCH_LOCATION_INDEX ?? '',
    key,
    CACHE_MAX_AGE_SECONDS,
  );
  if (cached?.result !== undefined) {
    await createFinishedLoungeJob(table, {
      id,
      owner: session.sessionId,
      locationKey: key,
      label: cleanLabel,
      lat,
      lon,
      ttlSeconds: JOB_TTL_SECONDS,
      result: cached.result,
    });
    return { jobId: id };
  }

  // Cache miss — create the job (owner = this session), which the stream fires the worker on.
  await createLoungeJob(table, {
    id,
    owner: session.sessionId,
    locationKey: key,
    label: cleanLabel,
    lat,
    lon,
    ttlSeconds: JOB_TTL_SECONDS,
  });

  return { jobId: id };
};

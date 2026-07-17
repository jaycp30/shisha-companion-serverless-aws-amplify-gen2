import { randomUUID } from 'node:crypto';
import { env } from '$amplify/env/start-menu-analysis';
import type { Schema } from '../../data/resource';
import { readSessionToken } from '../session-token';
import { createMenuJob } from '../menu-jobs';

// Keep in step with MAX_PAGES in the analyze-menu worker — every page is another image
// sent to Bedrock, so the cap is a cost control, not just a UX limit.
const MAX_PAGES = 5;
// Jobs (and the S3 objects they point at) are throwaway after analysis. A day is plenty
// for a session to read its result and comfortably covers retries; DynamoDB TTL then
// reaps the row. See the matching S3 lifecycle rule in backend.ts.
const JOB_TTL_SECONDS = 24 * 60 * 60;

export const handler: Schema['startMenuAnalysis']['functionHandler'] = async (event) => {
  const { sessionToken, s3Keys, userContext } = event.arguments;

  // Identity comes from the SIGNED token, never from an argument.
  const session = readSessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
  if (!session) {
    throw new Error('Session expired — please try again.');
  }

  // ClientSchema types array elements as nullable — drop any holes.
  const keys = (s3Keys ?? []).filter((k): k is string => typeof k === 'string');
  if (keys.length === 0) {
    throw new Error('No menu pages were provided.');
  }
  if (keys.length > MAX_PAGES) {
    throw new Error(`Too many pages (max ${MAX_PAGES}).`);
  }

  // THE ownership boundary: every key must sit under this session's own prefix and look
  // exactly like a key get-upload-url would have signed (session id + uuid object id +
  // known extension). This is what stops one session replaying another session's keys
  // — which it could otherwise learn and re-submit to trigger fresh paid analysis.
  const expected = new RegExp(
    `^menu/${session.sessionId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`,
  );
  for (const key of keys) {
    if (!expected.test(key)) {
      throw new Error('One or more menu pages do not belong to this session.');
    }
  }

  const id = randomUUID();
  await createMenuJob(process.env.MENU_JOBS_TABLE_NAME ?? '', {
    id,
    owner: session.sessionId,
    s3Keys: keys,
    userContext: userContext ?? undefined,
    ttlSeconds: JOB_TTL_SECONDS,
  });

  return { jobId: id };
};

import { env } from '$amplify/env/get-menu-analysis-status';
import type { Schema } from '../../data/resource';
import { readSessionToken } from '../session-token';
import { getMenuJob } from '../menu-jobs';

export const handler: Schema['getMenuAnalysisStatus']['functionHandler'] = async (
  event,
) => {
  const { sessionToken, jobId } = event.arguments;

  const session = readSessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
  if (!session) {
    throw new Error('Session expired — please try again.');
  }

  const job = await getMenuJob(process.env.MENU_JOBS_TABLE_NAME ?? '', jobId);

  // Ownership: a caller only sees its OWN job. A job that doesn't exist and a job owned
  // by someone else return the SAME answer, so this can't be used to probe whether an
  // id exists for another session.
  if (!job || job.owner !== session.sessionId) {
    return { status: 'NOT_FOUND', result: null, errorMessage: null };
  }

  // Only the minimum the client needs — never the S3 keys, owner, or user context.
  return {
    status: job.status,
    result: job.result ?? null,
    errorMessage: job.errorMessage ?? null,
  };
};

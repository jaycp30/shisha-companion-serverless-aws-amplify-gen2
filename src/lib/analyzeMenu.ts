import { client } from './amplify';
import { getSessionToken } from './sessionToken';
import type { MenuResponse } from '../types/menu';

// Guard rails checked in the browser, before we bother the backend at all.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
// A menu can span pages. Keep this in step with MAX_PAGES in start-menu-analysis, which
// enforces the same cap server-side — this check is only a courtesy to the user.
export const MAX_PAGES = 5;
// How long we poll a job before giving up — a little past the worker's 120s timeout,
// so a genuinely stuck job fails cleanly rather than hanging the UI.
const ANALYSIS_TIMEOUT_MS = 130_000;
// How often we ask the backend whether the job is done. Analysis takes 30-50s, so a
// 1.5s cadence is responsive without hammering the endpoint.
const POLL_INTERVAL_MS = 1500;

// Which step of the flow we're on — the component uses this to show status.
// Presigning is folded into 'uploading': each page presigns and PUTs as one unit, and
// they all run at once, so there is no moment where "presigning" is the honest answer.
export type Stage = 'uploading' | 'analyzing';

// Errors we raise deliberately, with a message that is safe to show the user.
// Anything else that escapes (network drop, etc.) is handled generically by the caller.
export class MenuUploadError extends Error {}

interface AnalyzeOptions {
  userContext?: string;
  onStage?: (stage: Stage) => void;
  /** Keys of pages the cat already knows — new photos are appended to these. */
  previousKeys?: readonly string[];
}

export interface AnalyzeOutcome {
  response: MenuResponse;
  /** Every page (old + new) behind `response` — feed back in as previousKeys. */
  s3Keys: string[];
}

/** Presign, then POST one page. Returns the S3 key the analyzer should read. */
async function uploadPage(file: File, sessionToken: string): Promise<string> {
  // 1. Ask the backend to presign an S3 POST for this content type. The session token
  //    proves a Turnstile challenge was passed AND identifies the session — the server
  //    derives the whole key (including the session prefix) from it, so the client no
  //    longer chooses any part of the path. The POST policy also pins a size range that
  //    S3 enforces, so an oversized body is rejected at the edge regardless of the client.
  const presign = await client.mutations.getUploadUrl({
    contentType: file.type,
    sessionToken,
  });
  if (presign.errors?.length || !presign.data) {
    throw new MenuUploadError(
      presign.errors?.[0]?.message ?? "Couldn't start the upload.",
    );
  }
  const { uploadUrl, formFields, s3Key } = presign.data;

  // 2. Build the multipart form: every policy field the server signed, then the file
  //    LAST — S3 ignores anything after the `file` part, so it must come at the end.
  const form = new FormData();
  const fields = JSON.parse(formFields) as Record<string, string>;
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  form.append('file', file);

  // 3. POST straight to S3. Do NOT set Content-Type ourselves — the browser sets the
  //    multipart boundary. S3 returns 4xx if the body violates the signed policy (wrong
  //    size, wrong type), which we surface as a clean upload error.
  const upload = await fetch(uploadUrl, { method: 'POST', body: form });
  if (!upload.ok) {
    throw new MenuUploadError(`Upload failed (HTTP ${upload.status}).`);
  }

  return s3Key;
}

/**
 * Upload the pages of one menu and get flavor recommendations back.
 *
 * The image bytes go BROWSER -> S3 directly via a presigned POST; they never pass
 * through a Lambda (which caps request payloads at 6 MB). Only the object keys are
 * sent to analyzeMenu, which reads every page in a SINGLE vision call so the model
 * can pair across pages.
 *
 * `files` is ordered: files[0] is page 1.
 */
export async function analyzeMenuPages(
  files: readonly File[],
  { userContext, onStage, previousKeys = [] }: AnalyzeOptions = {},
): Promise<AnalyzeOutcome> {
  if (files.length === 0) {
    throw new MenuUploadError('Pick at least one menu photo.');
  }
  if (previousKeys.length + files.length > MAX_PAGES) {
    throw new MenuUploadError(
      previousKeys.length > 0
        ? `The cat already knows ${previousKeys.length} page(s) and can hold ${MAX_PAGES} — start a new menu or pick fewer photos.`
        : `That's more than ${MAX_PAGES} pages — pick fewer.`,
    );
  }
  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new MenuUploadError('Please pick JPEG, PNG, or WebP images.');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new MenuUploadError(`"${file.name}" is over 10 MB — try a smaller photo.`);
    }
  }

  // One session token covers every page — fetched BEFORE the parallel presigns
  // because a Turnstile token is single-use: five concurrent challenges would be
  // five widget runs, but one HMAC session token is freely reusable. This may pop
  // the (usually invisible) human check on first use.
  let sessionToken: string;
  try {
    sessionToken = await getSessionToken();
  } catch (error) {
    throw new MenuUploadError(
      error instanceof Error ? error.message : 'Human check failed — please try again.',
    );
  }

  // Pages are independent uploads, so run them together. Promise.all preserves input
  // order in its result, which is what keeps page 1 as page 1 for the model.
  onStage?.('uploading');
  const newKeys = await Promise.all(files.map((file) => uploadPage(file, sessionToken)));

  // Append semantics: the job re-reads the whole accumulated menu (old pages + new) in
  // one vision call, so picks and pairings can span everything the cat has seen.
  const s3Keys = [...previousKeys, ...newKeys];

  // Analysis is too slow for a synchronous request (it blows past AppSync's ~30s
  // ceiling), so it runs as a background job. startMenuAnalysis validates that these
  // keys belong to our signed session, then creates the job; we poll for the outcome.
  // The SAME token is used for upload, start, and poll so the server sees one session.
  onStage?.('analyzing');
  const started = await client.mutations.startMenuAnalysis({
    sessionToken,
    s3Keys,
    userContext,
  });
  if (started.errors?.length || !started.data) {
    throw new MenuUploadError(
      started.errors?.[0]?.message ?? "Couldn't start the analysis.",
    );
  }

  return { response: await pollJob(started.data.jobId, sessionToken), s3Keys };
}

// A job row's `result` (a.json) round-trips as an object here — but tolerate a stringified
// form too. Narrow at the boundary rather than casting blindly, so a bad shape surfaces as
// a clean error instead of crashing the render.
function extractResult(result: unknown): MenuResponse {
  const parsed: unknown = typeof result === 'string' ? JSON.parse(result) : result;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new MenuUploadError('Got an unexpected response from the menu reader.');
  }
  return parsed as MenuResponse;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the job until it reaches a terminal status: DONE -> the analysis, ERROR -> throw.
 *
 * Polling (not a subscription) because the job store is now a private backend table with
 * no public subscribe surface — getMenuAnalysisStatus returns ONLY this session's own job.
 * A transient GraphQL error is retried rather than aborting the whole flow; a timeout just
 * past the worker's 120s stops a genuinely stuck job from spinning forever.
 */
async function pollJob(jobId: string, sessionToken: string): Promise<MenuResponse> {
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const poll = await client.queries.getMenuAnalysisStatus({ jobId, sessionToken });

    if (poll.errors?.length || !poll.data) {
      // Transient — wait and try again rather than failing the whole analysis.
      await delay(POLL_INTERVAL_MS);
      continue;
    }

    const { status, result, errorMessage } = poll.data;
    if (status === 'DONE') {
      return extractResult(result);
    }
    if (status === 'ERROR') {
      throw new MenuUploadError(errorMessage ?? "Couldn't read that menu.");
    }
    if (status === 'NOT_FOUND') {
      // The job we just created isn't ours to read — should never happen in a normal
      // flow (same token throughout), so treat it as a hard failure, not a retry.
      throw new MenuUploadError("That analysis couldn't be found — please try again.");
    }
    // PENDING / PROCESSING — keep waiting.
    await delay(POLL_INTERVAL_MS);
  }

  throw new MenuUploadError('The menu reader took too long — please try again.');
}

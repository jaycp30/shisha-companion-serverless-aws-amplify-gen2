import { client } from './amplify';
import type { MenuResponse } from '../types/menu';

// Guard rails checked in the browser, before we bother the backend at all.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
// A menu can span pages. Keep this in step with MAX_PAGES in the analyze-menu Lambda,
// which enforces the same cap — this check is only a courtesy to the user.
export const MAX_PAGES = 5;
// How long we wait for a job before giving up — a little past the worker's 120s timeout,
// so a genuinely stuck job fails cleanly rather than hanging the UI.
const ANALYSIS_TIMEOUT_MS = 130_000;

// Which step of the flow we're on — the component uses this to show status.
// Presigning is folded into 'uploading': each page presigns and PUTs as one unit, and
// they all run at once, so there is no moment where "presigning" is the honest answer.
export type Stage = 'uploading' | 'analyzing';

// Errors we raise deliberately, with a message that is safe to show the user.
// Anything else that escapes (network drop, etc.) is handled generically by the caller.
export class MenuUploadError extends Error {}

// One id per page load, so a session's photos group under menu/<sessionId>/ in S3.
// Deliberately NOT persisted (no localStorage): a fresh visit is a fresh session.
const SESSION_ID = crypto.randomUUID();

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

/** Presign, then PUT one page. Returns the S3 key the analyzer should read. */
async function uploadPage(file: File): Promise<string> {
  // 1. Ask the backend to presign an S3 PUT for this content type.
  const presign = await client.mutations.getUploadUrl({
    contentType: file.type,
    sessionId: SESSION_ID,
  });
  if (presign.errors?.length || !presign.data) {
    throw new MenuUploadError(
      presign.errors?.[0]?.message ?? "Couldn't start the upload.",
    );
  }
  const { uploadUrl, s3Key } = presign.data;

  // 2. Send the bytes straight to S3. Content-Type MUST match what we signed with,
  //    or S3 rejects the request with a 403.
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!upload.ok) {
    throw new MenuUploadError(`Upload failed (HTTP ${upload.status}).`);
  }

  return s3Key;
}

/**
 * Upload the pages of one menu and get flavor recommendations back.
 *
 * The image bytes go BROWSER -> S3 directly via a presigned PUT; they never pass
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

  // Pages are independent uploads, so run them together. Promise.all preserves input
  // order in its result, which is what keeps page 1 as page 1 for the model.
  onStage?.('uploading');
  const newKeys = await Promise.all(files.map(uploadPage));

  // Append semantics: the job re-reads the whole accumulated menu (old pages + new) in
  // one vision call, so picks and pairings can span everything the cat has seen.
  const s3Keys = [...previousKeys, ...newKeys];

  // Analysis is too slow for a synchronous request (it blows past AppSync's ~30s
  // ceiling), so it runs as a background job: create a PENDING row, then wait for a
  // stream-triggered worker to fill in the result. See understanding.md.
  onStage?.('analyzing');
  const created = await client.models.MenuAnalysis.create({
    status: 'PENDING',
    s3Keys,
    userContext,
  });
  if (created.errors?.length || !created.data) {
    throw new MenuUploadError(
      created.errors?.[0]?.message ?? "Couldn't start the analysis.",
    );
  }

  return { response: await waitForJob(created.data.id), s3Keys };
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

/**
 * Resolve once the job reaches a terminal status: DONE -> the analysis, ERROR -> throw.
 *
 * Subscribes to updates for this one job, with two safety nets:
 *  - an initial get(), in case the worker finished in the sliver between create and
 *    subscribe (so onUpdate never fires for the transition);
 *  - a timeout just past the worker's own 120s, so a stuck job fails cleanly instead of
 *    spinning forever.
 */
function waitForJob(jobId: string): Promise<MenuResponse> {
  return new Promise<MenuResponse>((resolve, reject) => {
    let settled = false;
    let sub: { unsubscribe: () => void } | undefined;

    const timer = window.setTimeout(() => {
      finish(() =>
        reject(
          new MenuUploadError('The menu reader took too long — please try again.'),
        ),
      );
    }, ANALYSIS_TIMEOUT_MS);

    // Run exactly one terminal action, then tear everything down.
    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      sub?.unsubscribe();
      action();
    }

    function handle(job: { status?: string | null; result?: unknown; errorMessage?: string | null }): void {
      if (job.status === 'DONE') {
        try {
          const result = extractResult(job.result);
          finish(() => resolve(result));
        } catch (error) {
          finish(() => reject(error));
        }
      } else if (job.status === 'ERROR') {
        finish(() =>
          reject(new MenuUploadError(job.errorMessage ?? "Couldn't read that menu.")),
        );
      }
    }

    sub = client.models.MenuAnalysis.onUpdate({
      filter: { id: { eq: jobId } },
    }).subscribe({
      next: handle,
      error: () =>
        finish(() =>
          reject(new MenuUploadError('Lost connection to the menu reader.')),
        ),
    });

    void client.models.MenuAnalysis.get({ id: jobId })
      .then(({ data }) => {
        if (data) handle(data);
      })
      .catch(() => {
        /* the subscription is the primary path; ignore a failed pre-check */
      });
  });
}

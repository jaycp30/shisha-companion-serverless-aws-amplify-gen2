import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { DynamoDBStreamHandler } from 'aws-lambda';
import { env } from '$amplify/env/analyze-menu';
import { SYSTEM_PROMPT } from './prompt';
import { parseMenuAnalysis, type MenuResponse } from './schema';
import { checkRateLimit } from '../rate-limit';
import { claimMenuJob, finishMenuJob } from '../menu-jobs';

const bedrock = new BedrockRuntimeClient();
const s3 = new S3Client();

// Cap paid vision analyses per session. Uploads are infrequent (a user scans one menu,
// maybe a few pages), so 10 per 10 minutes is generous while stopping a runaway client.
// The sessionId now comes from the SERVER-signed upload prefix (validated when the job
// was created), so rotating it means passing Turnstile again for each new session —
// this is a real per-session cap, not the previously spoofable one. Budget alarms
// remain the account-level backstop.
const MENU_RATE_LIMIT = 10;
const MENU_RATE_WINDOW_SECONDS = 600;

// Keys look like `menu/<sessionId>/<file>`; pull the session segment out to key the
// rate limit. Falls back to a shared bucket for any unexpected shape.
function sessionIdFromKey(s3Key: string | undefined): string {
  return s3Key?.split('/')[1] || 'unknown';
}

// Upper bound on tokens the model may generate for one analysis. Headroom for a
// multi-page menu's picks, mixes and pairings — the response no longer echoes the whole
// menu back (that unused field was the thing overflowing 2000 and truncating the JSON).
const MAX_TOKENS = 4096;
// Lower temperature: we want consistent, well-structured JSON, not creativity.
const TEMPERATURE = 0.4;
// How many menu pages we will read in one analysis. The frontend enforces this too, but
// the create endpoint is public (`publicApiKey`), so the client's word is not worth
// trusting: every extra page is another image sent to Bedrock — more tokens and money.
const MAX_PAGES = 5;

// Load the uploaded photo from S3 as raw bytes for the vision call.
async function loadImageBytes(s3Key: string): Promise<Uint8Array> {
  const object = await s3.send(
    new GetObjectCommand({
      Bucket: env.SHISHA_MENU_UPLOADS_BUCKET_NAME,
      Key: s3Key,
    }),
  );
  return object.Body!.transformToByteArray();
}

// Map the object key's extension to a Bedrock image format.
function imageFormat(s3Key: string): 'png' | 'jpeg' | 'webp' {
  if (s3Key.endsWith('.png')) return 'png';
  if (s3Key.endsWith('.webp')) return 'webp';
  return 'jpeg';
}

// The actual work: read every page and ask Claude for structured recommendations.
// Returns the validated MenuResponse (or throws, which the caller turns into an ERROR row).
async function analyzePages(
  keys: string[],
  userContext: string | null | undefined,
): Promise<MenuResponse> {
  if (keys.length === 0) {
    throw new Error('No menu pages were provided.');
  }
  if (keys.length > MAX_PAGES) {
    throw new Error(`Too many pages: ${keys.length} (max ${MAX_PAGES}).`);
  }

  // Fetch the pages concurrently — they are independent S3 reads, and doing them in
  // series would add a round trip per page to a call that is already slow.
  const pages = await Promise.all(
    keys.map(async (key) => ({
      format: imageFormat(key),
      bytes: await loadImageBytes(key),
    })),
  );

  // ONE call carrying every page, in order. The model must see the whole menu at once:
  // a drink listed on the last page can only be paired with a flavour on the first if
  // both are in the same request.
  const pageCount = pages.length;
  const contextLine = userContext
    ? `User context: ${userContext}`
    : 'No extra context was provided.';

  const messages: Message[] = [
    {
      role: 'user',
      content: [
        ...pages.map((page) => ({
          image: { format: page.format, source: { bytes: page.bytes } },
        })),
        {
          text:
            pageCount === 1
              ? `Here is the shisha menu photo. ${contextLine}`
              : `Here are ${pageCount} photos. They are consecutive pages of ONE menu, in order (page 1 first). Read them together as a single menu. ${contextLine}`,
        },
      ],
    },
  ];

  const response = await bedrock.send(
    new ConverseCommand({
      modelId: env.MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages,
      inferenceConfig: { maxTokens: MAX_TOKENS, temperature: TEMPERATURE },
    }),
  );

  const text = response.output?.message?.content?.[0]?.text ?? '';
  // Validate at the boundary before storing it (see schema.ts).
  return parseMenuAnalysis(text);
}

// Process one newly-created job: run the analysis and write the outcome back onto the row.
// NEVER throws — a thrown error would make the stream retry the record, re-running the
// (paid) Bedrock call, possibly in a loop. Instead every path writes a terminal status,
// so the client's polling always sees an outcome.
async function processJob(id: string): Promise<void> {
  const table = process.env.MENU_JOBS_TABLE_NAME ?? '';
  try {
    // Claim the job atomically (PENDING -> PROCESSING) BEFORE any paid work. A duplicate
    // stream delivery of a job already claimed/terminal gets null here and does nothing,
    // so the (expensive) Bedrock call runs at most once per job.
    const job = await claimMenuJob(table, id);
    if (!job) {
      console.log(`Job ${id} was already claimed or terminal — skipping.`);
      return;
    }
    const keys = job.s3Keys;

    // Throttle per session before the (paid) vision call. Fail-open by design.
    const { allowed } = await checkRateLimit(
      'menu',
      sessionIdFromKey(keys[0]),
      MENU_RATE_LIMIT,
      MENU_RATE_WINDOW_SECONDS,
    );
    if (!allowed) {
      await finishMenuJob(table, id, {
        status: 'ERROR',
        errorMessage:
          "You've scanned a lot of menus just now — give it a minute and try again.",
      });
      return;
    }

    const result = await analyzePages(keys, job.userContext);
    await finishMenuJob(table, id, { status: 'DONE', result: JSON.stringify(result) });
  } catch (error) {
    // A SyntaxError means the MODEL's output was unparseable — that detail belongs in
    // the logs, not in the user's face. Our own thrown Errors are written to be shown.
    const message =
      error instanceof SyntaxError
        ? 'The menu reader got confused — please try that photo again.'
        : error instanceof Error
          ? error.message
          : 'Menu analysis failed.';
    console.error(`Menu analysis job ${id} failed:`, error);
    try {
      await finishMenuJob(table, id, { status: 'ERROR', errorMessage: message });
    } catch (writeError) {
      // Nothing left to fall back to — at least leave the truth in the logs.
      console.error(`Could not mark job ${id} as ERROR:`, writeError);
    }
  }
}

// Triggered by the MenuJobs table stream. The EventSourceMapping is filtered to INSERT,
// so we normally only see brand-new jobs; the in-handler guard is belt-and-braces (and
// stops us reacting to our own DONE/ERROR write-backs, which arrive as MODIFY).
export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    if (record.eventName !== 'INSERT') continue;
    const id = record.dynamodb?.Keys?.id?.S;
    if (id) {
      await processJob(id);
    }
  }
  return { batchItemFailures: [] };
};

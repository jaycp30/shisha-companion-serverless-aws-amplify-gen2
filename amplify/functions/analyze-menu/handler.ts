import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { DynamoDBStreamHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/analyze-menu';
import type { Schema } from '../../data/resource';
import { SYSTEM_PROMPT } from './prompt';
import { parseMenuAnalysis, type MenuResponse } from './schema';

const bedrock = new BedrockRuntimeClient();
const s3 = new S3Client();

// Data client, so the worker can write results back onto the job row. Configured from
// env values injected by the schema-level `allow.resource(analyzeMenu)` grant.
const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

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
// (paid) Bedrock call, possibly in a loop. Instead every path resolves the row, so the
// client's subscription always sees a terminal status.
async function processJob(id: string): Promise<void> {
  try {
    const { data: job, errors } = await client.models.MenuAnalysis.get({ id });
    if (errors || !job) {
      throw new Error(errors?.[0]?.message ?? `Job ${id} not found.`);
    }

    // ClientSchema types array elements as nullable — drop any holes.
    const keys = (job.s3Keys ?? []).filter(
      (key): key is string => typeof key === 'string',
    );
    const result = await analyzePages(keys, job.userContext);

    // The data client does NOT throw on a failed mutation — it returns errors in-band.
    // Ignoring them here once left jobs stuck at PENDING forever with clean-looking logs.
    const updated = await client.models.MenuAnalysis.update({
      id,
      status: 'DONE',
      result: JSON.stringify(result),
    });
    if (updated.errors?.length) {
      throw new Error(`Write-back failed: ${JSON.stringify(updated.errors)}`);
    }
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
    const marked = await client.models.MenuAnalysis.update({
      id,
      status: 'ERROR',
      errorMessage: message,
    });
    if (marked.errors?.length) {
      // Nothing left to fall back to — at least leave the truth in the logs.
      console.error(`Could not mark job ${id} as ERROR:`, JSON.stringify(marked.errors));
    }
  }
}

// Triggered by the MenuAnalysis table stream. The EventSourceMapping is filtered to
// INSERT, so we normally only see brand-new jobs; the in-handler guard is belt-and-braces
// (and stops us reacting to our own DONE/ERROR write-backs, which arrive as MODIFY).
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

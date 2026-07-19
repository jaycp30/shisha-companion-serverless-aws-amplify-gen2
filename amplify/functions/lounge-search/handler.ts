import type { DynamoDBStreamHandler } from 'aws-lambda';
import { SYSTEM_PROMPT } from './prompt';
import { parseLoungeList } from './schema';
import { checkRateLimit } from '../rate-limit';
import { claimLoungeJob, finishLoungeJob, type LoungeJob } from '../lounge-jobs';

// Claude Platform on AWS — Anthropic-operated, first-party API parity INCLUDING the hosted
// web_search server tool (Amazon Bedrock has no native web search for Claude, which is why
// the cat/chat stays on Bedrock and only THIS search-needing path uses Claude Platform).
// Authenticated by the Lambda's execution role via SigV4 — no API key to store. Reads
// AWS_REGION (set by Lambda) and ANTHROPIC_AWS_WORKSPACE_ID from the env (wired in
// backend.ts). CJS/ESM interop: the client is a default export under some bundlers.
import AnthropicAwsImport from '@anthropic-ai/aws-sdk';
const AnthropicAws = (AnthropicAwsImport as unknown as { default?: unknown }).default ?? AnthropicAwsImport;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anthropic = new (AnthropicAws as any)();

// Bare first-party model id — Claude Platform on AWS takes NO `anthropic.` / `jp.` prefix
// (that's Bedrock). Haiku is plenty for "search and list venues" and is the cheap tier.
const MODEL_ID = 'claude-haiku-4-5';
// Cap searches per request to bound cost. Each search round feeds result HTML back as input
// tokens, so this is the main lever on per-call spend alongside the rate limits.
const WEB_SEARCH_MAX_USES = 4;
const MAX_TOKENS = 2048;

// The hosted web-search tool. `allowed_callers: ["direct"]` disables dynamic filtering
// (which needs programmatic tool calling), so the tool works on Haiku 4.5 — matching the
// proven config in the hiking-planner project on this same account/platform. If a sandbox
// verify ever 400s on this type, fall back to the basic `web_search_20250305` variant.
const WEB_SEARCH_TOOL = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: WEB_SEARCH_MAX_USES,
  allowed_callers: ['direct'],
};

// Per-session cap: at most 5 web searches per hour. Generous for a real user, tight enough
// that an abusive client can't run up the (paid) search bill. Fail-CLOSED (see rate-limit.ts).
const LOUNGE_RATE_LIMIT = 5;
const LOUNGE_RATE_WINDOW_SECONDS = 60 * 60;
// Global daily budget across ALL sessions — the hard spend cap and the real backstop.
// Worst case ~50 uncached searches/day. Keyed on a fixed string so every session shares it.
const GLOBAL_DAILY_LIMIT = 50;
const GLOBAL_DAILY_WINDOW_SECONDS = 24 * 60 * 60;

// Pull the text out of the model's response content blocks (skipping tool-use/thinking).
function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('\n');
}

// Ask Claude (with hosted web search) for lounges near the job's coordinates, and validate
// the JSON it returns. Throws on an unusable reply, which the caller turns into an ERROR row.
async function searchLounges(job: LoungeJob): Promise<string> {
  const userMessage =
    `Find shisha or hookah lounges near ${job.label} ` +
    `(approximate coordinates ${job.lat.toFixed(4)}, ${job.lon.toFixed(4)}).`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (anthropic as any).messages.create({
    model: MODEL_ID,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [WEB_SEARCH_TOOL],
    messages: [{ role: 'user', content: userMessage }],
  });

  const list = parseLoungeList(extractText(response.content));
  return JSON.stringify(list);
}

// Process one newly-created job: run the search and write the outcome back. NEVER throws —
// a thrown error would make the stream retry the record and re-run the (paid) search,
// possibly in a loop. Every path writes a terminal status so the client's polling resolves.
async function processJob(id: string): Promise<void> {
  const table = process.env.LOUNGE_SEARCH_JOBS_TABLE_NAME ?? '';
  try {
    // Claim atomically (PENDING -> PROCESSING) BEFORE any paid work. A duplicate stream
    // delivery of an already-claimed/terminal job gets null here and does nothing, so the
    // paid search runs at most once per job.
    const job = await claimLoungeJob(table, id);
    if (!job) {
      console.log(`Lounge job ${id} was already claimed or terminal — skipping.`);
      return;
    }

    // Two throttles before the paid call, both fail-CLOSED: the per-session cap, then the
    // global daily budget. Either tripping means we do NOT pay for a search.
    const perSession = await checkRateLimit(
      'lounge',
      job.owner,
      LOUNGE_RATE_LIMIT,
      LOUNGE_RATE_WINDOW_SECONDS,
    );
    if (!perSession.allowed) {
      await finishLoungeJob(table, id, {
        status: 'ERROR',
        errorMessage:
          perSession.reason === 'unavailable'
            ? 'The web search is briefly unavailable — please try again in a moment.'
            : "You've run a lot of web searches — give it a little while and try again.",
      });
      return;
    }
    const globalBudget = await checkRateLimit(
      'lounge',
      'global-daily',
      GLOBAL_DAILY_LIMIT,
      GLOBAL_DAILY_WINDOW_SECONDS,
    );
    if (!globalBudget.allowed) {
      await finishLoungeJob(table, id, {
        status: 'ERROR',
        errorMessage:
          "The cat's done a lot of web searching today — try again tomorrow, or search by map above.",
      });
      return;
    }

    const result = await searchLounges(job);
    await finishLoungeJob(table, id, { status: 'DONE', result });
  } catch (error) {
    // A SyntaxError/ZodError means the MODEL's output was unusable — a log detail, not
    // something to show the user verbatim.
    const message =
      error instanceof Error && (error.name === 'SyntaxError' || error.name === 'ZodError')
        ? 'The web search came back garbled — please try again.'
        : error instanceof Error
          ? error.message
          : 'The web search failed.';
    console.error(`Lounge search job ${id} failed:`, error);
    try {
      await finishLoungeJob(table, id, { status: 'ERROR', errorMessage: message });
    } catch (writeError) {
      console.error(`Could not mark lounge job ${id} as ERROR:`, writeError);
    }
  }
}

// Triggered by the LoungeSearchJobs table stream (filtered to INSERT in backend.ts, so we
// normally only see brand-new jobs; the in-handler claim is belt-and-braces and stops us
// reacting to our own DONE/ERROR write-backs, which arrive as MODIFY).
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

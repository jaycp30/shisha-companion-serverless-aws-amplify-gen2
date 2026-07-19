import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
  ConditionalCheckFailedException,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';

// The lounge web-search job store. Same design as menu-jobs.ts: a PLAIN DynamoDB table
// (provisioned in backend.ts), invisible to the GraphQL API — the only ways in are the
// start/get-status Lambdas, which enforce ownership by the signed session id.
//
// One extra trick over the menu store: a GSI on `locationKey` doubles as the RESULT
// CACHE. Before creating (and paying for) a new web search, start-lounge-search queries
// the GSI for a recent DONE job at the same normalized location and returns that job's
// id instead — the client polls it and gets the cached result instantly. The row TTL
// (24h) plus the freshness window in findCachedLoungeJob bound staleness.

const dynamo = new DynamoDBClient();

export type JobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'ERROR';

export interface LoungeJob {
  id: string;
  /** The signed session id that created this job — the ownership key. */
  owner: string;
  /** Normalized location (rounded lat/lon grid cell) — the cache key. */
  locationKey: string;
  /** Human-readable place label, shown back to the user and used in the prompt. */
  label: string;
  lat: number;
  lon: number;
  status: JobStatus;
  /** JSON string of the LoungeResult[] once DONE. */
  result?: string;
  /** User-safe message when ERROR. */
  errorMessage?: string;
}

interface CreateJobInput {
  id: string;
  owner: string;
  locationKey: string;
  label: string;
  lat: number;
  lon: number;
  /** Row self-deletes this many seconds from now (DynamoDB TTL). */
  ttlSeconds: number;
}

export async function createLoungeJob(
  tableName: string,
  input: CreateJobInput,
): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const item: Record<string, AttributeValue> = {
    id: { S: input.id },
    owner: { S: input.owner },
    locationKey: { S: input.locationKey },
    label: { S: input.label },
    lat: { N: String(input.lat) },
    lon: { N: String(input.lon) },
    status: { S: 'PENDING' },
    createdAt: { N: String(nowSeconds) },
    expiresAt: { N: String(nowSeconds + input.ttlSeconds) },
  };
  // Guard against an id collision overwriting an existing job.
  await dynamo.send(
    new PutItemCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
}

/**
 * Insert an already-DONE job owned by `owner`, carrying a result copied from a cache hit.
 * Used when start-lounge-search finds a recent search for the same location by ANOTHER
 * session: rather than serve that session's row (which would fail the owner check on poll)
 * or pay for a fresh search, we mint this session its own finished copy.
 *
 * This row's INSERT still fires the stream worker, but the worker's PENDING-only claim
 * fails on a DONE row and no-ops — so no paid search runs. That spurious invocation is
 * ~$0 and buys a clean ownership boundary (every session polls only its own job).
 */
export async function createFinishedLoungeJob(
  tableName: string,
  input: CreateJobInput & { result: string },
): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await dynamo.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        id: { S: input.id },
        owner: { S: input.owner },
        locationKey: { S: input.locationKey },
        label: { S: input.label },
        lat: { N: String(input.lat) },
        lon: { N: String(input.lon) },
        status: { S: 'DONE' },
        result: { S: input.result },
        createdAt: { N: String(nowSeconds) },
        expiresAt: { N: String(nowSeconds + input.ttlSeconds) },
      },
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
}

// Rebuild a LoungeJob from raw DynamoDB attributes, or null if the status is unreadable.
function unmarshalJob(
  id: string,
  item: Record<string, AttributeValue>,
): LoungeJob | null {
  const status = item.status?.S;
  if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'DONE' && status !== 'ERROR') {
    return null;
  }
  return {
    id,
    owner: item.owner?.S ?? '',
    locationKey: item.locationKey?.S ?? '',
    label: item.label?.S ?? '',
    lat: Number(item.lat?.N ?? '0'),
    lon: Number(item.lon?.N ?? '0'),
    status,
    result: item.result?.S,
    errorMessage: item.errorMessage?.S,
  };
}

export async function getLoungeJob(
  tableName: string,
  id: string,
): Promise<LoungeJob | null> {
  const { Item } = await dynamo.send(
    // Strongly consistent: the client polls this immediately after creating the job, so
    // an eventually-consistent read could miss its own brand-new row and look NOT_FOUND.
    new GetItemCommand({ TableName: tableName, Key: { id: { S: id } }, ConsistentRead: true }),
  );
  return Item ? unmarshalJob(id, Item) : null;
}

/**
 * The cache lookup: newest DONE job for this locationKey no older than `maxAgeSeconds`.
 * Returns null on any error — a broken cache should cost one extra paid search, never
 * fail the request. (GSI reads are eventually consistent, which is fine for a cache.)
 */
export async function findCachedLoungeJob(
  tableName: string,
  indexName: string,
  locationKey: string,
  maxAgeSeconds: number,
): Promise<LoungeJob | null> {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  try {
    const { Items } = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: 'locationKey = :k AND createdAt >= :cutoff',
        // Only a finished job is a usable cache hit. `status` is a reserved word.
        FilterExpression: '#status = :done',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':k': { S: locationKey },
          ':cutoff': { N: String(cutoff) },
          ':done': { S: 'DONE' },
        },
        // Newest first, and a small page: the filter drops non-DONE rows AFTER the key
        // match, so scan a handful rather than exactly one.
        ScanIndexForward: false,
        Limit: 10,
      }),
    );
    for (const item of Items ?? []) {
      const id = item.id?.S;
      if (!id) continue;
      const job = unmarshalJob(id, item);
      if (job?.status === 'DONE') return job;
    }
    return null;
  } catch (error) {
    console.error('Lounge cache lookup failed (treating as miss):', error);
    return null;
  }
}

/**
 * Atomically claim a job for processing: flip PENDING -> PROCESSING and return the job,
 * or return null if it is already PROCESSING/DONE/ERROR (or gone). Same idempotency
 * guard as claimMenuJob — stream delivery is at-least-once and the web search runs
 * 30-60s, so only the delivery that wins this conditional write does the paid work.
 */
export async function claimLoungeJob(
  tableName: string,
  id: string,
): Promise<LoungeJob | null> {
  try {
    const { Attributes } = await dynamo.send(
      new UpdateItemCommand({
        TableName: tableName,
        Key: { id: { S: id } },
        UpdateExpression: 'SET #status = :processing',
        ConditionExpression: '#status = :pending',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':processing': { S: 'PROCESSING' },
          ':pending': { S: 'PENDING' },
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return Attributes ? unmarshalJob(id, Attributes) : null;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return null;
    throw error;
  }
}

interface TerminalUpdate {
  status: 'DONE' | 'ERROR';
  result?: string;
  errorMessage?: string;
}

/** Write the terminal outcome onto a job row. */
export async function finishLoungeJob(
  tableName: string,
  id: string,
  update: TerminalUpdate,
): Promise<void> {
  const values: Record<string, AttributeValue> = { ':s': { S: update.status } };
  // `status` and `result` are DynamoDB reserved words; only alias what the expression
  // actually references (DynamoDB rejects unused ExpressionAttributeNames entries).
  const names: Record<string, string> = { '#status': 'status' };
  const sets = ['#status = :s'];
  if (update.result !== undefined) {
    values[':r'] = { S: update.result };
    names['#result'] = 'result';
    sets.push('#result = :r');
  }
  if (update.errorMessage !== undefined) {
    values[':e'] = { S: update.errorMessage };
    sets.push('errorMessage = :e');
  }
  await dynamo.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: { id: { S: id } },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

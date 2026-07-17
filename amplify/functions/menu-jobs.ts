import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  ConditionalCheckFailedException,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';

// The menu-analysis job store. Deliberately a PLAIN DynamoDB table (provisioned in
// backend.ts), NOT an Amplify data model — Amplify Gen 2 has no "function-only" model,
// so exposing jobs as a model would auto-generate public CRUD we'd then have to fight.
// As a bare table it is invisible to the GraphQL API: the only ways in are the
// start/get-status Lambdas, which enforce ownership by the signed session id.
//
// Marshalling is done by hand (like rate-limit.ts) to avoid pulling in
// util-dynamodb/lib-dynamodb — the item shape is small and fixed.

const dynamo = new DynamoDBClient();

export type JobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'ERROR';

export interface MenuJob {
  id: string;
  /** The signed session id that created this job — the ownership key. */
  owner: string;
  status: JobStatus;
  s3Keys: string[];
  userContext?: string;
  /** JSON string of the MenuResponse once DONE. */
  result?: string;
  /** User-safe message when ERROR. */
  errorMessage?: string;
}

interface CreateJobInput {
  id: string;
  owner: string;
  s3Keys: string[];
  userContext?: string;
  /** Row self-deletes this many seconds from now (DynamoDB TTL). */
  ttlSeconds: number;
}

export async function createMenuJob(
  tableName: string,
  input: CreateJobInput,
): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const item: Record<string, AttributeValue> = {
    id: { S: input.id },
    owner: { S: input.owner },
    status: { S: 'PENDING' },
    s3Keys: { L: input.s3Keys.map((key) => ({ S: key })) },
    createdAt: { N: String(nowSeconds) },
    expiresAt: { N: String(nowSeconds + input.ttlSeconds) },
  };
  if (input.userContext) {
    item.userContext = { S: input.userContext };
  }
  // Guard against an id collision overwriting an existing job.
  await dynamo.send(
    new PutItemCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
}

// Rebuild a MenuJob from raw DynamoDB attributes, or null if the status is unreadable.
function unmarshalJob(
  id: string,
  item: Record<string, AttributeValue>,
): MenuJob | null {
  const status = item.status?.S;
  if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'DONE' && status !== 'ERROR') {
    return null;
  }
  return {
    id,
    owner: item.owner?.S ?? '',
    status,
    s3Keys: (item.s3Keys?.L ?? [])
      .map((v) => v.S)
      .filter((s): s is string => typeof s === 'string'),
    userContext: item.userContext?.S,
    result: item.result?.S,
    errorMessage: item.errorMessage?.S,
  };
}

export async function getMenuJob(
  tableName: string,
  id: string,
): Promise<MenuJob | null> {
  const { Item } = await dynamo.send(
    // Strongly consistent: the client polls this immediately after creating the job, so
    // an eventually-consistent read could miss its own brand-new row and look NOT_FOUND.
    new GetItemCommand({ TableName: tableName, Key: { id: { S: id } }, ConsistentRead: true }),
  );
  return Item ? unmarshalJob(id, Item) : null;
}

/**
 * Atomically claim a job for processing: flip PENDING -> PROCESSING and return the job,
 * or return null if the job is already PROCESSING/DONE/ERROR (or gone).
 *
 * This is the idempotency guard for the stream worker. DynamoDB stream delivery is
 * at-least-once, and a Bedrock call can run 30-50s, so the same job may be delivered
 * twice (e.g. after a timeout). Only the delivery that wins this conditional write does
 * the paid work; a duplicate delivery sees a non-PENDING status and skips.
 */
export async function claimMenuJob(
  tableName: string,
  id: string,
): Promise<MenuJob | null> {
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
    // The job wasn't PENDING — already claimed by another delivery, or already terminal.
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
export async function finishMenuJob(
  tableName: string,
  id: string,
  update: TerminalUpdate,
): Promise<void> {
  const values: Record<string, AttributeValue> = { ':s': { S: update.status } };
  // `status` is a DynamoDB reserved word; only alias others when they're actually used,
  // because DynamoDB rejects an ExpressionAttributeNames entry the expression never references.
  const names: Record<string, string> = { '#status': 'status' };
  const sets = ['#status = :s'];
  if (update.result !== undefined) {
    values[':r'] = { S: update.result };
    names['#result'] = 'result'; // also reserved
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

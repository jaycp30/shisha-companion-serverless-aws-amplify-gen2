import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
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

export async function getMenuJob(
  tableName: string,
  id: string,
): Promise<MenuJob | null> {
  const { Item } = await dynamo.send(
    // Strongly consistent: the client polls this immediately after creating the job, so
    // an eventually-consistent read could miss its own brand-new row and look NOT_FOUND.
    new GetItemCommand({ TableName: tableName, Key: { id: { S: id } }, ConsistentRead: true }),
  );
  if (!Item) return null;

  const status = Item.status?.S;
  if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'DONE' && status !== 'ERROR') {
    return null;
  }
  return {
    id,
    owner: Item.owner?.S ?? '',
    status,
    s3Keys: (Item.s3Keys?.L ?? [])
      .map((v) => v.S)
      .filter((s): s is string => typeof s === 'string'),
    userContext: Item.userContext?.S,
    result: Item.result?.S,
    errorMessage: Item.errorMessage?.S,
  };
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

import {
  DynamoDBClient,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

// Shared by the chat and analyze-menu handlers. A DynamoDB fixed-window rate
// limiter: for each (scope, key, time-window) we keep one counter item that TTLs
// itself out, so old windows self-clean and the cost is a single on-demand write
// per checked request. See backend.ts for the table (partition key `pk`, TTL
// attribute `expiresAt`).

const dynamo = new DynamoDBClient();

export interface RateLimitResult {
  allowed: boolean;
  // Requests seen in the current window for this key (including this one).
  count: number;
}

/**
 * Atomically count this request against a fixed window and report whether it is
 * within `limit`. Fail-open: if the check itself errors (throttling, missing
 * table, etc.) we allow the request rather than block a real user over an infra
 * hiccup — the point is to cap abuse, not to gate every call behind DynamoDB.
 *
 * @param scope   Namespaces the counter, e.g. 'chat' or 'menu'.
 * @param key     Per-caller identity, e.g. a client IP or session id.
 * @param limit   Max allowed requests within one window.
 * @param windowSeconds Window length; each window is a separate, self-expiring item.
 */
export async function checkRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const tableName = process.env.RATE_LIMIT_TABLE_NAME;
  if (!tableName) {
    // Not wired up — don't hard-fail the request path over a config gap.
    console.error('RATE_LIMIT_TABLE_NAME is not set; skipping rate limit.');
    return { allowed: true, count: 0 };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowIndex = Math.floor(nowSeconds / windowSeconds);
  const pk = `${scope}#${key}#${windowIndex}`;
  // Keep the item a little past its window so a late request in the same window
  // still sees the running count; DynamoDB TTL then reaps it automatically.
  const expiresAt = (windowIndex + 2) * windowSeconds;

  try {
    const result = await dynamo.send(
      new UpdateItemCommand({
        TableName: tableName,
        Key: { pk: { S: pk } },
        // ADD creates the number at 0 then increments; SET only stamps the TTL on
        // first write so we don't keep pushing it out on every hit.
        UpdateExpression:
          'ADD reqCount :one SET expiresAt = if_not_exists(expiresAt, :exp)',
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':exp': { N: String(expiresAt) },
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    const count = Number(result.Attributes?.reqCount?.N ?? '1');
    return { allowed: count <= limit, count };
  } catch (error) {
    console.error('Rate limit check failed (allowing request):', error);
    return { allowed: true, count: 0 };
  }
}

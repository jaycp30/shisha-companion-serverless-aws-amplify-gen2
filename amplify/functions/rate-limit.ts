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

// Why a request was (dis)allowed, so callers can log truthfully and message the user
// appropriately — 'unavailable' is a system fault, not the user hitting their cap.
export type RateLimitReason = 'ok' | 'over_limit' | 'unavailable';

export interface RateLimitResult {
  allowed: boolean;
  // Requests seen in the current window for this key (including this one).
  count: number;
  reason: RateLimitReason;
}

/**
 * Atomically count this request against a fixed window and report whether it is
 * within `limit`. Fail-CLOSED: this limiter's whole job is to cap paid Bedrock spend,
 * so if the check itself can't run (throttling, missing table, outage) we DENY rather
 * than let calls through ungated at exactly the moment abuse could spike. A DynamoDB
 * blip briefly blocks paid calls — the conservative trade for a spend guard. The
 * `reason` lets the caller tell "you hit your limit" apart from "system unavailable".
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
    // A deploy-time misconfiguration, not a runtime blip — fail closed and loudly so it
    // is caught immediately rather than silently disabling every rate limit in prod.
    console.error('RATE_LIMIT_TABLE_NAME is not set; denying (fail closed).');
    return { allowed: false, count: 0, reason: 'unavailable' };
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
    const allowed = count <= limit;
    return { allowed, count, reason: allowed ? 'ok' : 'over_limit' };
  } catch (error) {
    // Can't run the check — deny (fail closed) to protect Bedrock spend.
    console.error('Rate limit check failed (denying, fail closed):', error);
    return { allowed: false, count: 0, reason: 'unavailable' };
  }
}

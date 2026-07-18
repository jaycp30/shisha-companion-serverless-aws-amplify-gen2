import { defineBackend } from '@aws-amplify/backend';
import { Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { StartingPosition, EventSourceMapping, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { AttributeType, BillingMode, StreamViewType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { getUploadUrl } from './functions/get-upload-url/resource';
import { mintSessionToken } from './functions/mint-session-token/resource';
import { startMenuAnalysis } from './functions/start-menu-analysis/resource';
import { getMenuAnalysisStatus } from './functions/get-menu-analysis-status/resource';
import { analyzeMenu } from './functions/analyze-menu/resource';
import { chat } from './functions/chat/resource';
import { FOUNDATION_MODEL_ID, MODEL_ID } from './functions/model';

// Composition root: register every resource. The returned `backend` object
// exposes the underlying CDK constructs, which we use below (the "escape hatch").
const backend = defineBackend({
  auth,
  data,
  storage,
  getUploadUrl,
  mintSessionToken,
  startMenuAnalysis,
  getMenuAnalysisStatus,
  analyzeMenu,
  chat,
});

// Curator login is invite-only: NOBODY can self-register. Gen 2 has no `defineAuth`
// option for this, so we reach for the CFN resource directly. Without this the user
// pool would happily accept public sign-ups, and "verified" notes would mean nothing
// — anyone could register and mint trust. This single line is what makes the
// verified tier worth having.
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Gen 2 has no `define*` for Bedrock, so grant InvokeModel via raw CDK IAM.
// Invoking through the jp. inference profile checks access to BOTH the profile
// ARN and the foundation model it routes to, so we scope to both (not bedrock:*).
const bedrockInvokePolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: [
    `arn:aws:bedrock:*:*:inference-profile/${MODEL_ID}`,
    `arn:aws:bedrock:*::foundation-model/${FOUNDATION_MODEL_ID}*`,
  ],
});

backend.analyzeMenu.resources.lambda.addToRolePolicy(bedrockInvokePolicy);
backend.chat.resources.lambda.addToRolePolicy(bedrockInvokePolicy);

// --- Menu-analysis job store -------------------------------------------------
// A plain CDK table, NOT an Amplify data model. Amplify Gen 2 can't make a model
// function-only (a model always exposes public CRUD to some caller class), and a public
// job model is precisely what let anyone list/modify/replay every job. As a bare table
// this is invisible to the GraphQL API — the only ways in are the start/get-status
// Lambdas, which enforce per-session ownership.
//
// stream NEW_IMAGE: newly-created jobs trigger the worker (below). TTL `expiresAt`:
// jobs self-delete a day after creation (see start-menu-analysis). Lives in the data
// stack alongside the functions (resourceGroupName 'data') to avoid cross-stack cycles.
const menuJobsTable = new Table(backend.data.stack, 'MenuJobs', {
  partitionKey: { name: 'id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'expiresAt',
  stream: StreamViewType.NEW_IMAGE,
  removalPolicy: RemovalPolicy.DESTROY,
});

// Least privilege per function: start creates jobs, get-status only reads, the worker
// reads a job and writes its outcome.
menuJobsTable.grantWriteData(backend.startMenuAnalysis.resources.lambda);
menuJobsTable.grantReadData(backend.getMenuAnalysisStatus.resources.lambda);
menuJobsTable.grantReadWriteData(backend.analyzeMenu.resources.lambda);
for (const fn of [
  backend.startMenuAnalysis,
  backend.getMenuAnalysisStatus,
  backend.analyzeMenu,
]) {
  fn.addEnvironment('MENU_JOBS_TABLE_NAME', menuJobsTable.tableName);
}

// Trigger the worker from the job table's stream, filtered to INSERT: new jobs run once,
// but the worker's own DONE/ERROR write-backs (MODIFY) do not — which stops a loop.
menuJobsTable.grantStreamRead(backend.analyzeMenu.resources.lambda);

// Bounded, monitored retry. DynamoDB stream delivery is at-least-once and a Bedrock call
// runs 30-50s, so a record can be re-delivered. The in-handler claim already makes
// reprocessing a no-op (at most one paid call per job), so retries here only cover an
// infra failure (a Lambda crash before it writes a terminal status). Without these
// settings the AWS defaults (batchSize 100, retry until the record expires ~24h) would
// let one poison record block the shard and re-run paid work for hours.
const menuJobsDlq = new Queue(backend.data.stack, 'MenuJobsDlq', {
  retentionPeriod: Duration.days(14),
});

new EventSourceMapping(Stack.of(menuJobsTable), 'AnalyzeMenuJobStreamMapping', {
  target: backend.analyzeMenu.resources.lambda,
  eventSourceArn: menuJobsTable.tableStreamArn,
  startingPosition: StartingPosition.LATEST,
  // One job per invocation: a single slow job can't drag a batch of others into a timeout.
  batchSize: 1,
  // Finite retries + an age cap, then the record is dropped to the DLQ rather than
  // blocking the shard indefinitely.
  retryAttempts: 3,
  maxRecordAge: Duration.minutes(5),
  onFailure: new SqsDlq(menuJobsDlq),
  filters: [FilterCriteria.filter({ eventName: FilterRule.isEqual('INSERT') })],
});

// Monitoring. These surface in the CloudWatch console; wiring an SNS notification target
// is a small follow-up (needs a destination address). A record in the DLQ means a job
// failed every retry; elevated errors or a high iterator age means the worker is unhealthy
// or the stream is backing up.
menuJobsDlq
  .metricApproximateNumberOfMessagesVisible()
  .createAlarm(backend.data.stack, 'MenuJobsDlqNotEmpty', {
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
    alarmDescription: 'A menu-analysis job exhausted retries and landed in the DLQ.',
  });
backend.analyzeMenu.resources.lambda
  .metricErrors({ period: Duration.minutes(5) })
  .createAlarm(backend.data.stack, 'AnalyzeMenuErrors', {
    threshold: 5,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
    alarmDescription: 'analyze-menu worker is erroring at an elevated rate.',
  });
backend.analyzeMenu.resources.lambda
  .metric('IteratorAge', { statistic: 'Maximum', period: Duration.minutes(5) })
  .createAlarm(backend.data.stack, 'AnalyzeMenuIteratorAge', {
    threshold: Duration.minutes(5).toMilliseconds(),
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
    alarmDescription: 'The menu-jobs stream is falling behind (iterator age high).',
  });

// --- App-level rate limiting for the paid Bedrock paths ----------------------
// The API is `apiKey` auth with a key baked into the shipped frontend bundle, so
// it is effectively public. Rather than pay AWS WAF's standing monthly fee to
// guard mostly-personal traffic, we throttle inside the two Lambdas that actually
// spend money on Bedrock (chat + analyze-menu), backed by a small counter table.
//
// This is a plain CDK table, NOT an Amplify data model, so it never shows up in
// the public GraphQL schema. Fixed-window counters keyed by client identity; the
// `expiresAt` TTL reaps old windows for free. Lives in the data stack alongside
// both functions (they are resourceGroupName 'data') to avoid cross-stack cycles.
const rateLimitTable = new Table(backend.data.stack, 'RateLimit', {
  partitionKey: { name: 'pk', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'expiresAt',
  // Just ephemeral counters — safe to drop if the stack is ever torn down.
  removalPolicy: RemovalPolicy.DESTROY,
});

// Both Bedrock-spending functions use the counters; mint-session-token also uses the
// SAME table to enforce a global budget on degraded (Turnstile-unavailable) mints.
for (const fn of [backend.chat, backend.analyzeMenu, backend.mintSessionToken]) {
  rateLimitTable.grantReadWriteData(fn.resources.lambda);
  fn.addEnvironment('RATE_LIMIT_TABLE_NAME', rateLimitTable.tableName);
}

// Hostname a genuine Turnstile challenge must have been solved on (public domain, not a
// secret). Injected here rather than in the function's resource.ts because that file is
// pulled into the frontend tsconfig graph and must stay free of `process`. Set it in the
// Amplify Console branch env for prod (TURNSTILE_EXPECTED_HOSTNAME=shisha.jaycloud.net);
// blank in sandbox skips the hostname + action checks so the Cloudflare test keys verify.
backend.mintSessionToken.addEnvironment(
  'TURNSTILE_EXPECTED_HOSTNAME',
  process.env.TURNSTILE_EXPECTED_HOSTNAME ?? '',
);

// Uploaded menu photos are throwaway once analyzed — expire them a day after upload so
// the bucket doesn't accumulate personal images indefinitely. Matches the job-record TTL.
// `resources.bucket` is typed IBucket (no addLifecycleRule), so set it on the L1 CfnBucket.
backend.storage.resources.cfnResources.cfnBucket.lifecycleConfiguration = {
  rules: [
    {
      id: 'expire-menu-uploads',
      status: 'Enabled',
      prefix: 'menu/',
      expirationInDays: 1,
    },
  ],
};

// Cost-allocation / governance tags. Applied at the root stack; the CDK Tag
// aspect cascades them into every nested stack (data, storage, functions) and
// tags all taggable resources the backend creates.
const tags = Tags.of(backend.stack);
tags.add('Project', 'shisha-buddy');
tags.add('Stack', 'AmplifyGen2');

import { defineBackend } from '@aws-amplify/backend';
import { Aws, Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
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
import { startLoungeSearch } from './functions/start-lounge-search/resource';
import { getLoungeSearchStatus } from './functions/get-lounge-search-status/resource';
import { loungeSearch } from './functions/lounge-search/resource';
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
  startLoungeSearch,
  getLoungeSearchStatus,
  loungeSearch,
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

// --- Lounge web-search job store + worker ------------------------------------
// The paid escalation behind the free OpenStreetMap lounge finder: when OSM coverage is
// thin, the worker asks Claude (with hosted web search) for lounges near a point. Same
// async-job shape as menu analysis — a mutation creates a job, this table's stream fires
// the worker, the client polls a status query — because a web-search call runs 30-60s,
// well past AppSync's ~30s ceiling. A plain CDK table (invisible to the GraphQL API); the
// GSI on locationKey doubles as the result cache (see start-lounge-search + lounge-jobs).
const LOUNGE_LOCATION_INDEX = 'byLocation';
const loungeSearchJobsTable = new Table(backend.data.stack, 'LoungeSearchJobs', {
  partitionKey: { name: 'id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'expiresAt',
  stream: StreamViewType.NEW_IMAGE,
  removalPolicy: RemovalPolicy.DESTROY,
});
// Cache index: newest DONE job for a location grid cell. Sort by createdAt so the query can
// bound freshness; project ALL so the cache read can copy `result` without a second lookup.
loungeSearchJobsTable.addGlobalSecondaryIndex({
  indexName: LOUNGE_LOCATION_INDEX,
  partitionKey: { name: 'locationKey', type: AttributeType.STRING },
  sortKey: { name: 'createdAt', type: AttributeType.NUMBER },
});

// Least privilege: start creates/reads (cache) jobs, get-status only reads, the worker
// reads a job and writes its outcome.
loungeSearchJobsTable.grantReadWriteData(backend.startLoungeSearch.resources.lambda);
loungeSearchJobsTable.grantReadData(backend.getLoungeSearchStatus.resources.lambda);
loungeSearchJobsTable.grantReadWriteData(backend.loungeSearch.resources.lambda);
for (const fn of [
  backend.startLoungeSearch,
  backend.getLoungeSearchStatus,
  backend.loungeSearch,
]) {
  fn.addEnvironment('LOUNGE_SEARCH_JOBS_TABLE_NAME', loungeSearchJobsTable.tableName);
}
backend.startLoungeSearch.addEnvironment('LOUNGE_SEARCH_LOCATION_INDEX', LOUNGE_LOCATION_INDEX);

// Trigger the worker from the job table's stream, filtered to INSERT (new jobs run once;
// the worker's own DONE/ERROR write-backs arrive as MODIFY and are ignored — stops a loop).
loungeSearchJobsTable.grantStreamRead(backend.loungeSearch.resources.lambda);

// Bounded, monitored retry — identical rationale to the menu worker: stream delivery is
// at-least-once and a web-search call runs 30-60s, so a record can be re-delivered. The
// in-handler PENDING-only claim already makes reprocessing a no-op (at most one paid search
// per job), so these settings only cap an infra failure rather than re-running paid work.
const loungeSearchDlq = new Queue(backend.data.stack, 'LoungeSearchDlq', {
  retentionPeriod: Duration.days(14),
});
new EventSourceMapping(Stack.of(loungeSearchJobsTable), 'LoungeSearchJobStreamMapping', {
  target: backend.loungeSearch.resources.lambda,
  eventSourceArn: loungeSearchJobsTable.tableStreamArn,
  startingPosition: StartingPosition.LATEST,
  batchSize: 1,
  retryAttempts: 3,
  maxRecordAge: Duration.minutes(5),
  onFailure: new SqsDlq(loungeSearchDlq),
  filters: [FilterCriteria.filter({ eventName: FilterRule.isEqual('INSERT') })],
});

// Same three alarms as the menu worker: a DLQ message means a job exhausted retries;
// elevated errors or a high iterator age means the worker is unhealthy or backing up.
loungeSearchDlq
  .metricApproximateNumberOfMessagesVisible()
  .createAlarm(backend.data.stack, 'LoungeSearchDlqNotEmpty', {
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
    alarmDescription: 'A lounge-search job exhausted retries and landed in the DLQ.',
  });
backend.loungeSearch.resources.lambda
  .metricErrors({ period: Duration.minutes(5) })
  .createAlarm(backend.data.stack, 'LoungeSearchErrors', {
    threshold: 5,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
    alarmDescription: 'lounge-search worker is erroring at an elevated rate.',
  });
backend.loungeSearch.resources.lambda
  .metric('IteratorAge', { statistic: 'Maximum', period: Duration.minutes(5) })
  .createAlarm(backend.data.stack, 'LoungeSearchIteratorAge', {
    threshold: Duration.minutes(5).toMilliseconds(),
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
    alarmDescription: 'The lounge-search jobs stream is falling behind (iterator age high).',
  });

// Claude Platform on AWS access for the worker ONLY (nothing else calls it). Least
// privilege, mirroring the hiking-planner policy: the Messages API on one workspace, plus
// the STS web-identity exchange the SDK does before each call. This is the ONE path that
// leaves Bedrock — the cat/chat + menu analysis stay on Bedrock via bedrockInvokePolicy.
// The workspace id is a per-environment value (see below), injected as an env var.
const claudePlatformPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['aws-external-anthropic:CreateInference'],
  resources: [
    `arn:aws:aws-external-anthropic:${Aws.REGION}:${Aws.ACCOUNT_ID}:workspace/${
      process.env.ANTHROPIC_AWS_WORKSPACE_ID ?? '*'
    }`,
  ],
});
const claudePlatformStsPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['sts:GetWebIdentityToken', 'sts:TagGetWebIdentityToken'],
  resources: [`arn:aws:sts::${Aws.ACCOUNT_ID}:self`],
});
backend.loungeSearch.resources.lambda.addToRolePolicy(claudePlatformPolicy);
backend.loungeSearch.resources.lambda.addToRolePolicy(claudePlatformStsPolicy);

// The Claude Platform workspace to bill/route to — NOT a secret, but a per-environment
// value: set the Amplify prod branch env var ANTHROPIC_AWS_WORKSPACE_ID (the new "shisha"
// workspace), and put it in .env.local for the sandbox. Injected here (not in the function's
// resource.ts) because that file is pulled into the frontend tsconfig graph and must stay
// free of `process`. Blank means no workspace — the worker will fail its call, which is the
// correct, loud outcome for a missing config.
backend.loungeSearch.addEnvironment(
  'ANTHROPIC_AWS_WORKSPACE_ID',
  process.env.ANTHROPIC_AWS_WORKSPACE_ID ?? '',
);

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

// Every paid-AI function uses the counters; mint-session-token also uses the SAME table to
// enforce a global budget on degraded (Turnstile-unavailable) mints. lounge-search adds the
// per-session + global-daily caps on its (paid) Claude Platform web searches.
for (const fn of [
  backend.chat,
  backend.analyzeMenu,
  backend.mintSessionToken,
  backend.loungeSearch,
]) {
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

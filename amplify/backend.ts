import { defineBackend } from '@aws-amplify/backend';
import { RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { StartingPosition, EventSourceMapping, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { getUploadUrl } from './functions/get-upload-url/resource';
import { mintSessionToken } from './functions/mint-session-token/resource';
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

// Trigger the analyze-menu worker from the MenuAnalysis table's DynamoDB stream.
// Amplify enables the stream on model tables by default (it powers subscriptions), so we
// only attach a mapping. Filtered to INSERT: new jobs trigger a run, but the worker's own
// DONE/ERROR write-backs (MODIFY events) do not — which is what stops an infinite loop.
const menuAnalysisTable = backend.data.resources.tables['MenuAnalysis'];

const streamReadPolicy = new Policy(
  Stack.of(menuAnalysisTable),
  'AnalyzeMenuStreamReadPolicy',
  {
    statements: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:ListStreams',
        ],
        resources: [menuAnalysisTable.tableStreamArn!],
      }),
    ],
  },
);
backend.analyzeMenu.resources.lambda.role?.attachInlinePolicy(streamReadPolicy);

const streamMapping = new EventSourceMapping(
  Stack.of(menuAnalysisTable),
  'AnalyzeMenuJobStreamMapping',
  {
    target: backend.analyzeMenu.resources.lambda,
    eventSourceArn: menuAnalysisTable.tableStreamArn,
    startingPosition: StartingPosition.LATEST,
    // Only wake the worker for freshly-created jobs.
    filters: [FilterCriteria.filter({ eventName: FilterRule.isEqual('INSERT') })],
  },
);
streamMapping.node.addDependency(streamReadPolicy);

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

// Both Bedrock-spending functions read+write the counters and need the table name.
for (const fn of [backend.chat, backend.analyzeMenu]) {
  rateLimitTable.grantReadWriteData(fn.resources.lambda);
  fn.addEnvironment('RATE_LIMIT_TABLE_NAME', rateLimitTable.tableName);
}

// Cost-allocation / governance tags. Applied at the root stack; the CDK Tag
// aspect cascades them into every nested stack (data, storage, functions) and
// tags all taggable resources the backend creates.
const tags = Tags.of(backend.stack);
tags.add('Project', 'shisha-buddy');
tags.add('Stack', 'AmplifyGen2');

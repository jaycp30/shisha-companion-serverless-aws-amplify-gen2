import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { getUploadUrl } from '../functions/get-upload-url/resource';
import { mintSessionToken } from '../functions/mint-session-token/resource';
import { analyzeMenu } from '../functions/analyze-menu/resource';
import { chat } from '../functions/chat/resource';

// `getUploadUrl` and `chat` are custom AppSync operations that just invoke a Lambda.
// `MenuAnalysis` is a real model (a DynamoDB table): menu analysis is too slow to run
// inside AppSync's ~30s request ceiling, so it runs as an async job instead — the client
// creates a PENDING row, a stream-triggered worker fills in the result, and the client
// subscribes for the flip to DONE. See understanding.md for the full rationale.
// `publicApiKey` means no login: an API key ships to the frontend.
const schema = a
  .schema({
    // Presign an S3 PUT for the menu photo. `sessionId` (a client-minted UUID) groups
    // one browsing session's photos under menu/<sessionId>/ — optional so older
    // frontends keep working.
    // Exchange a Cloudflare Turnstile token (single-use, minutes-lived) for our own
    // reusable HMAC session token (hours-lived). One challenge per browsing session
    // then covers every protected call — including the PARALLEL presigns of a
    // multi-page upload, which a single-use token could never satisfy.
    mintSessionToken: a
      .mutation()
      .arguments({ turnstileToken: a.string().required() })
      .returns(
        a.customType({
          token: a.string().required(),
          expiresAt: a.integer().required(),
        }),
      )
      .authorization((allow) => [allow.publicApiKey()])
      .handler(a.handler.function(mintSessionToken)),

    getUploadUrl: a
      .mutation()
      .arguments({
        contentType: a.string().required(),
        sessionId: a.string(),
        // Proof a Turnstile challenge was passed (see mintSessionToken) — verified
        // in the handler before any presigned URL is issued.
        sessionToken: a.string().required(),
      })
      .returns(
        a.customType({
          uploadUrl: a.string().required(),
          s3Key: a.string().required(),
        }),
      )
      .authorization((allow) => [allow.publicApiKey()])
      .handler(a.handler.function(getUploadUrl)),

    // One async menu-analysis job. The client writes status PENDING + the inputs; the
    // analyze-menu worker (triggered by this table's stream) writes back status DONE +
    // `result`, or ERROR + `errorMessage`.
    MenuAnalysis: a
      .model({
        status: a.enum(['PENDING', 'DONE', 'ERROR']),
        // Ordered S3 keys of the uploaded pages (page 1 first).
        s3Keys: a.string().array().required(),
        // Optional free-text context (group size, mood, tolerance…).
        userContext: a.string(),
        // The MenuResponse JSON once DONE (either the analysis or { error: 'not_a_menu' }).
        result: a.json(),
        // A user-safe message when status is ERROR.
        errorMessage: a.string(),
      })
      .authorization((allow) => [allow.publicApiKey()]),

    // One anonymous, model-sanitized observation about a venue ("service slows down on
    // weekends"). Written ONLY by the chat Lambda — clients can read but never write,
    // which is what keeps a public-API app's shared memory from being spammable
    // directly. storeKey is the normalized venue name (see chat handler).
    CafeNote: a
      .model({
        storeKey: a.string().required(),
        note: a.string().required(),
      })
      .secondaryIndexes((index) => [index('storeKey').queryField('listNotesByStore')])
      .authorization((allow) => [allow.publicApiKey().to(['read'])]),

    // Companion chat. Transcript + optional menu/session context come in as JSON
    // strings. `storeName` ties the chat to a venue's notes; `captureNote` marks the
    // last user message as the reply to the cat's café question.
    chat: a
      .query()
      .arguments({
        messagesJson: a.string().required(),
        menuJson: a.string(),
        sessionJson: a.string(),
        storeName: a.string(),
        captureNote: a.boolean(),
        // Proof a Turnstile challenge was passed (see mintSessionToken) — verified
        // in the handler before the (paid) Bedrock call.
        sessionToken: a.string().required(),
      })
      .returns(a.string())
      .authorization((allow) => [allow.publicApiKey()])
      .handler(a.handler.function(chat)),
  })
  // Let the Lambdas use the data API: analyze-menu writes job results back, chat reads
  // and writes café notes. Schema-level grant (not per-model) is how a function gets
  // data-client access; the handlers use generateClient().
  .authorization((allow) => [allow.resource(analyzeMenu), allow.resource(chat)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    // Max lifetime for an AppSync API key is 365 days — set a calendar reminder
    // to rotate it before then, or the public endpoints stop working.
    apiKeyAuthorizationMode: { expiresInDays: 365 },
  },
});

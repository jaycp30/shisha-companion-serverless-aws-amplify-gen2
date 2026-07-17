import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { getUploadUrl } from '../functions/get-upload-url/resource';
import { mintSessionToken } from '../functions/mint-session-token/resource';
import { startMenuAnalysis } from '../functions/start-menu-analysis/resource';
import { getMenuAnalysisStatus } from '../functions/get-menu-analysis-status/resource';
import { chat } from '../functions/chat/resource';

// Every op here is a custom AppSync operation backed by a Lambda. `publicApiKey` means
// no login: an API key ships to the frontend, so it's a routing key, not an auth
// boundary — the Lambdas enforce the real rules (Turnstile session token, per-session
// ownership).
//
// Menu analysis is too slow for AppSync's ~30s ceiling, so it runs as a background job.
// The job store is a PLAIN DynamoDB table (see backend.ts + menu-jobs.ts), NOT a data
// model — Amplify Gen 2 can't make a model function-only, and a public job model is
// exactly what let anyone list/modify/replay every job. Instead the client calls
// startMenuAnalysis (which validates page ownership and creates the job) then polls
// getMenuAnalysisStatus (which returns only that session's own job).
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

    // Presign an S3 POST for one menu page. The upload key is derived ENTIRELY server-side
    // from the signed session token (menu/<sessionId>/<uuid>.<ext>) — the client no longer
    // supplies any part of the path, so it can't aim an upload at another session's prefix.
    // POST (not PUT) so the policy can carry a content-length-range S3 enforces server-side.
    getUploadUrl: a
      .mutation()
      .arguments({
        contentType: a.string().required(),
        // Proof a Turnstile challenge was passed AND which session this is (see
        // mintSessionToken / session-token.ts). Verified before any URL is signed.
        sessionToken: a.string().required(),
      })
      .returns(
        a.customType({
          uploadUrl: a.string().required(),
          // The presigned POST policy fields, JSON-serialized. The client echoes these
          // verbatim as form fields alongside the file (a custom type can't hold a map).
          formFields: a.string().required(),
          s3Key: a.string().required(),
        }),
      )
      .authorization((allow) => [allow.publicApiKey()])
      .handler(a.handler.function(getUploadUrl)),

    // Start a menu-analysis job. Validates that every submitted S3 key belongs to the
    // caller's signed session, then creates the job row (owner = sessionId) in the
    // MenuJobs table. Returns only the new job id.
    startMenuAnalysis: a
      .mutation()
      .arguments({
        sessionToken: a.string().required(),
        // Ordered S3 keys of the uploaded pages (page 1 first).
        s3Keys: a.string().array().required(),
        // Optional free-text context (group size, mood, tolerance…).
        userContext: a.string(),
      })
      .returns(a.customType({ jobId: a.string().required() }))
      .authorization((allow) => [allow.publicApiKey()])
      .handler(a.handler.function(startMenuAnalysis)),

    // Poll one job's status — and ONLY if the caller's session owns it. A job that
    // doesn't exist and one owned by another session both return status NOT_FOUND, so
    // this can't enumerate other sessions' jobs. `result` is the MenuResponse JSON.
    getMenuAnalysisStatus: a
      .query()
      .arguments({
        sessionToken: a.string().required(),
        jobId: a.string().required(),
      })
      .returns(
        a.customType({
          status: a.string().required(),
          result: a.string(),
          errorMessage: a.string(),
        }),
      )
      .authorization((allow) => [allow.publicApiKey()])
      .handler(a.handler.function(getMenuAnalysisStatus)),

    // One model-sanitized observation about a venue ("service slows down on weekends").
    // Written ONLY by the chat Lambda — clients can read but never write, which is what
    // keeps a public-API app's shared memory from being spammable directly.
    // storeKey is the normalized venue name (see chat handler).
    //
    // `verified` marks a note contributed by a signed-in curator. It is set from the
    // AppSync-authenticated identity inside the Lambda, never from client input — and
    // since no client can write this model at all, it cannot be forged.
    CafeNote: a
      .model({
        storeKey: a.string().required(),
        note: a.string().required(),
        verified: a.boolean(),
      })
      .secondaryIndexes((index) => [index('storeKey').queryField('listNotesByStore')])
      .authorization((allow) => [
        allow.publicApiKey().to(['read']),
        allow.authenticated().to(['read']),
      ]),

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
      // Both modes: anonymous visitors call this with the API key, curators call it
      // with their Cognito token. The handler tells them apart via event.identity and
      // marks the resulting note verified or not — the client never gets a say.
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler(a.handler.function(chat)),
  })
  // Only `chat` uses the data API now (it reads/writes CafeNote via generateClient).
  // The menu-job Lambdas talk to their plain DynamoDB table with the AWS SDK instead, so
  // they need no data-API grant here. Schema-level grant is how a function gets
  // data-client access.
  .authorization((allow) => [allow.resource(chat)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // Still apiKey by default: the app is anonymous-first and every public call keeps
    // working exactly as before. The Cognito user pool is only reached when the client
    // explicitly asks for it (authMode: 'userPool'), i.e. when a curator is signed in.
    defaultAuthorizationMode: 'apiKey',
    // Max lifetime for an AppSync API key is 365 days — set a calendar reminder
    // to rotate it before then, or the public endpoints stop working.
    apiKeyAuthorizationMode: { expiresInDays: 365 },
  },
});

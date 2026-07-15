import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { getUploadUrl } from '../functions/get-upload-url/resource';
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
    // Presign an S3 PUT for the menu photo.
    getUploadUrl: a
      .mutation()
      .arguments({ contentType: a.string().required() })
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

    // Companion chat. Transcript + optional menu/session context come in as JSON strings.
    chat: a
      .query()
      .arguments({
        messagesJson: a.string().required(),
        menuJson: a.string(),
        sessionJson: a.string(),
      })
      .returns(a.string())
      .authorization((allow) => [allow.publicApiKey()])
      .handler(a.handler.function(chat)),
  })
  // Let the worker write job results back to the API. Schema-level grant (not per-model)
  // is how a Lambda is given data-client access; the handler uses generateClient().
  .authorization((allow) => [allow.resource(analyzeMenu)]);

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

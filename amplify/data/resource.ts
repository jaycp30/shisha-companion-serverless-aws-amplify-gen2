import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { getUploadUrl } from '../functions/get-upload-url/resource';
import { analyzeMenu } from '../functions/analyze-menu/resource';
import { chat } from '../functions/chat/resource';

// No database models here. The three entries are custom AppSync operations that
// simply invoke a Lambda — AppSync is a typed front door, not a data store.
// `publicApiKey` means no login: an API key ships to the frontend.
const schema = a.schema({
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

  // Analyze an uploaded menu photo. Returns free-form JSON (validated in-Lambda).
  analyzeMenu: a
    .query()
    .arguments({ s3Key: a.string().required(), userContext: a.string() })
    .returns(a.json())
    .authorization((allow) => [allow.publicApiKey()])
    .handler(a.handler.function(analyzeMenu)),

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
});

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

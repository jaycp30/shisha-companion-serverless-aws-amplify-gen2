import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '$amplify/env/analyze-menu';
import type { Schema } from '../../data/resource';
import { SYSTEM_PROMPT } from './prompt';
import { parseMenuAnalysis } from './schema';

const bedrock = new BedrockRuntimeClient();
const s3 = new S3Client();

// Upper bound on tokens the model may generate for one analysis.
const MAX_TOKENS = 2000;
// Lower temperature: we want consistent, well-structured JSON, not creativity.
const TEMPERATURE = 0.4;

// Load the uploaded photo from S3 as raw bytes for the vision call.
async function loadImageBytes(s3Key: string): Promise<Uint8Array> {
  const object = await s3.send(
    new GetObjectCommand({
      Bucket: env.SHISHA_MENU_UPLOADS_BUCKET_NAME,
      Key: s3Key,
    }),
  );
  return object.Body!.transformToByteArray();
}

// Map the object key's extension to a Bedrock image format.
function imageFormat(s3Key: string): 'png' | 'jpeg' | 'webp' {
  if (s3Key.endsWith('.png')) return 'png';
  if (s3Key.endsWith('.webp')) return 'webp';
  return 'jpeg';
}

export const handler: Schema['analyzeMenu']['functionHandler'] = async (event) => {
  const { s3Key, userContext } = event.arguments;

  const imageBytes = await loadImageBytes(s3Key);

  const messages: Message[] = [
    {
      role: 'user',
      content: [
        { image: { format: imageFormat(s3Key), source: { bytes: imageBytes } } },
        {
          text: userContext
            ? `Here is the shisha menu photo. User context: ${userContext}`
            : 'Here is the shisha menu photo. No extra context was provided.',
        },
      ],
    },
  ];

  const response = await bedrock.send(
    new ConverseCommand({
      modelId: env.MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages,
      inferenceConfig: { maxTokens: MAX_TOKENS, temperature: TEMPERATURE },
    }),
  );

  const text = response.output?.message?.content?.[0]?.text ?? '';

  // Validate at the boundary before returning to the client (see schema.ts).
  return parseMenuAnalysis(text);
};

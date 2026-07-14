import { client } from './amplify';
import type { MenuResponse } from '../types/menu';

// Guard rails checked in the browser, before we bother the backend at all.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Which step of the flow we're on — the component uses this to show status.
export type Stage = 'presigning' | 'uploading' | 'analyzing';

// Errors we raise deliberately, with a message that is safe to show the user.
// Anything else that escapes (network drop, etc.) is handled generically by the caller.
export class MenuUploadError extends Error {}

interface AnalyzeOptions {
  userContext?: string;
  onStage?: (stage: Stage) => void;
}

/**
 * Upload a menu photo and get flavor recommendations back.
 *
 * The image bytes go BROWSER -> S3 directly via a presigned PUT; they never pass
 * through a Lambda (which caps request payloads at 6 MB). Only the object key is
 * sent to analyzeMenu.
 */
export async function analyzeMenuPhoto(
  file: File,
  { userContext, onStage }: AnalyzeOptions = {},
): Promise<MenuResponse> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new MenuUploadError('Please pick a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new MenuUploadError('That photo is over 10 MB — try a smaller one.');
  }

  // 1. Ask the backend to presign an S3 PUT for this content type.
  onStage?.('presigning');
  const presign = await client.mutations.getUploadUrl({ contentType: file.type });
  if (presign.errors?.length || !presign.data) {
    throw new MenuUploadError(
      presign.errors?.[0]?.message ?? "Couldn't start the upload.",
    );
  }
  const { uploadUrl, s3Key } = presign.data;

  // 2. Send the bytes straight to S3. Content-Type MUST match what we signed with,
  //    or S3 rejects the request with a 403.
  onStage?.('uploading');
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!upload.ok) {
    throw new MenuUploadError(`Upload failed (HTTP ${upload.status}).`);
  }

  // 3. Analyze it.
  onStage?.('analyzing');
  const analysis = await client.queries.analyzeMenu({ s3Key, userContext });
  if (analysis.errors?.length || analysis.data == null) {
    throw new MenuUploadError(
      analysis.errors?.[0]?.message ?? "Couldn't read that menu.",
    );
  }

  // AppSync's AWSJSON scalar arrives as a JSON-ENCODED STRING, not an object.
  // Parse it here, but tolerate an already-parsed object in case that ever changes.
  const raw: unknown = analysis.data;
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Narrow at the boundary instead of casting blindly — a bad shape here would
  // otherwise crash the render.
  if (typeof parsed !== 'object' || parsed === null) {
    throw new MenuUploadError('Got an unexpected response from the menu reader.');
  }

  return parsed as MenuResponse;
}

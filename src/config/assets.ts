// Media (mascot loops, background loops, BGM, posters) is NOT committed to this
// repo — it lives in a public, read-only S3 bucket. See ASSETS.md for the pipeline
// (scripts/fetch-assets.sh builds it, scripts/sync-assets.sh uploads it).
//
// Override with VITE_ASSET_BASE_URL to point somewhere else (another bucket, or a
// local copy served from public/).
const DEFAULT_BASE_URL =
  'https://shisha-companion-assets-441342223857.s3.ap-northeast-1.amazonaws.com';

export const ASSET_BASE_URL: string =
  (import.meta.env.VITE_ASSET_BASE_URL as string | undefined) ?? DEFAULT_BASE_URL;

// assetUrl('mascot/idle.mp4') -> https://<bucket>/mascot/idle.mp4
export function assetUrl(path: string): string {
  return `${ASSET_BASE_URL}/${path}`;
}

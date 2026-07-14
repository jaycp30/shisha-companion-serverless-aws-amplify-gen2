#!/usr/bin/env bash
#
# Upload the processed media in assets/dist/ to the public S3 assets bucket.
# Run this after scripts/fetch-assets.sh, and any time the assets change.
#
# --delete keeps the bucket an exact mirror of assets/dist/ (no orphaned old clips).
#
# Cache-Control is one day, not a year. The filenames are NOT content-hashed
# (idle.mp4 stays idle.mp4 when re-encoded), so an immutable year-long cache would
# leave browsers stuck on a stale clip. One day is a safe middle ground.
set -euo pipefail

REGION="ap-northeast-1"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="shisha-companion-assets-${ACCOUNT_ID}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$PROJECT_DIR/assets/dist"

if [ ! -d "$DIST" ]; then
  echo "No assets/dist/ — run scripts/fetch-assets.sh first." >&2
  exit 1
fi

echo "Syncing $DIST -> s3://$BUCKET"
aws s3 sync "$DIST" "s3://$BUCKET" \
  --region "$REGION" \
  --delete \
  --cache-control "public, max-age=86400"

echo ""
echo "Uploaded. Public base URL:"
echo "  https://${BUCKET}.s3.${REGION}.amazonaws.com"
echo ""
echo "Spot-check one file:"
echo "  curl -sI https://${BUCKET}.s3.${REGION}.amazonaws.com/mascot/idle.mp4 | head -1"

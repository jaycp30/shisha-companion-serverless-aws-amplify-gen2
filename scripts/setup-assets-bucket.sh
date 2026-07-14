#!/usr/bin/env bash
#
# ONE-TIME setup of the public S3 bucket that serves Shisha Companion's media
# (mascot loops, background loops, BGM, poster stills).
#
# SECURITY — read before running:
#   This bucket is deliberately WORLD-READABLE. It holds public media only.
#   * The policy grants s3:GetObject and NOTHING else.
#   * ListBucket is NOT granted, so the contents cannot be enumerated.
#   * Nobody but you can write to it.
#   * ACL-based public access stays BLOCKED; only this explicit bucket policy
#     opens read access (BlockPublicAcls / IgnorePublicAcls remain true).
#   NEVER put anything non-public in this bucket.
#
# The bucket is standalone on purpose: it is NOT part of the Amplify stack, so it
# survives `ampx sandbox delete` and is not tied to an ephemeral dev environment.
set -euo pipefail

REGION="ap-northeast-1"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="shisha-companion-assets-${ACCOUNT_ID}"

echo "Account : $ACCOUNT_ID"
echo "Bucket  : $BUCKET"
echo "Region  : $REGION"
echo ""

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "== Bucket already exists — reapplying settings =="
else
  echo "== Creating bucket =="
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION"
fi

# Allow a public bucket POLICY, but keep public ACLs blocked (defence in depth:
# nothing can be made public by accident via an object ACL).
echo "== Public access block (policy allowed, ACLs still blocked) =="
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"

echo "== Public read policy (GetObject only) =="
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {
      \"Sid\": \"PublicReadMediaObjects\",
      \"Effect\": \"Allow\",
      \"Principal\": \"*\",
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::${BUCKET}/*\"
    }
  ]
}"

# Howler plays audio through the Web Audio API, which fetches via XHR — that needs
# CORS. Plain <video> tags would not, but the audio path does.
echo "== CORS (GET/HEAD) =="
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedOrigins": ["*"],
      "ExposeHeaders": ["Content-Length", "Content-Type"],
      "MaxAgeSeconds": 3000
    }
  ]
}'

echo "== Cost-allocation tags =="
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging \
  'TagSet=[{Key=Project,Value=shisha-buddy},{Key=Stack,Value=StaticAssets}]'

echo ""
echo "Done. Public base URL:"
echo "  https://${BUCKET}.s3.${REGION}.amazonaws.com"

#!/usr/bin/env bash
# Bootstrap script — creates the S3 bucket and DynamoDB table
# needed for the Terraform remote backend. Run this ONCE.
#
# Usage: AWS_REGION=us-east-1 bash infra/terraform/scripts/bootstrap-backend.sh
#
# After running, uncomment the backend "s3" block in infra/terraform/variables.tf
# and run: terraform init -migrate-state

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
BUCKET="rpa-terraform-state-${RANDOM}"
TABLE="terraform-locks"

echo "Creating S3 bucket: $BUCKET"
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --acl private \
  2>&1

aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled \
  2>&1

aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --block-public-acls true \
  --ignore-public-acls true \
  --block-public-policy true \
  --restrict-public-buckets true \
  2>&1

echo "Creating DynamoDB table: $TABLE"
aws dynamodb create-table \
  --region "$REGION" \
  --table-name "$TABLE" \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  2>&1

echo ""
echo "Backend ready. Update variables.tf with:"
echo "  backend \"s3\" {"
echo "    bucket         = \"$BUCKET\""
echo "    key            = \"prod/terraform.tfstate\""
echo "    region         = \"$REGION\""
echo "    encrypt        = true"
echo "    dynamodb_table = \"$TABLE\""
echo "  }"

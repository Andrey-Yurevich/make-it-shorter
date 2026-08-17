#!/usr/bin/env bash
# Builds the Lambda artifact and puts it in S3. It deploys nothing: the deploy is
# `lambda_version` in Terraform, and a second way to change production would leave
# Terraform's state disagreeing with reality.
#
# Prints the short git sha — that is the value for lambda_version.
set -euo pipefail

bucket="${ARTIFACTS_BUCKET:-mis-artifacts}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build="${root}/build"

if [ -n "$(git -C "${root}" status --porcelain)" ]; then
  echo "working tree is dirty: the sha in the key would not describe what is in the zip" >&2
  exit 1
fi
sha="$(git -C "${root}" rev-parse --short HEAD)"

rm -rf "${build}"
mkdir -p "${build}"

# provided.al2023 runs a binary named bootstrap. catalog.json rides along beside it:
# the function reads it from the working directory at start and refuses to start without it.
cd "${root}/apps/backend"
go test ./...
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o "${build}/bootstrap" .
cp "${root}/catalog.json" "${build}/catalog.json"

cd "${build}"
zip -q "lambda-${sha}.zip" bootstrap catalog.json
aws s3 cp "lambda-${sha}.zip" "s3://${bucket}/lambda/${sha}.zip"

# The extension. Terraform has no use for this archive; it is kept because the store does
# not hand back what was uploaded to it, and knowing which build users are running is
# what makes a complaint answerable.
extension_zip="$("${root}/scripts/frontend-build.sh")"
extension_version="$(node -p "require('${root}/apps/extension/package.json').version")"
aws s3 cp "${extension_zip}" "s3://${bucket}/extension/${extension_version}.zip"

echo "${sha}"

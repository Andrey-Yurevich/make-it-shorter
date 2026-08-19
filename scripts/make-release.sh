#!/usr/bin/env bash
# Builds the Lambda artifact and puts it in S3. It deploys nothing: the deploy is
# `lambda_version` in Terraform, and a second way to change production would leave
# Terraform's state disagreeing with reality.
#
# Prints the label of the build — that is the value for lambda_version. A tag on HEAD is
# a release and the label is the tag; anything else is named by its short sha, the same
# rule the extension version follows.
set -euo pipefail

bucket="${ARTIFACTS_BUCKET:-mis-artifacts}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build="${root}/build/backend"

# The same rule apps/extension/manifest.ts follows, so one build is named one way
# everywhere: a version-shaped tag on HEAD is a release, and a tag of any other shape is
# not one. The leading v goes, because Chrome will not take it in a version.
label="$(git -C "${root}" tag --points-at HEAD | sed -n 's/^v\{0,1\}\([0-9][0-9.]*\)$/\1/p' | head -1)"
label="${label:-$(git -C "${root}" rev-parse --short HEAD)}"

# Each package owns a subdirectory of build/ and wipes only its own: the Lambda binary
# and the extension archive have nothing to do with each other, and a release of one must
# not take out what the other just produced.
rm -rf "${build}"
mkdir -p "${build}"

# provided.al2023 runs a binary named bootstrap, and that is the whole of the artifact:
# the function reads nothing from its working directory.
cd "${root}/apps/backend"
go test ./...
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o "${build}/bootstrap" .

cd "${build}"
zip -q "lambda-${label}.zip" bootstrap
aws s3 cp "lambda-${label}.zip" "s3://${bucket}/lambda/${label}.zip"

# The extension. Terraform has no use for this archive; it is kept because the store does
# not hand back what was uploaded to it, and knowing which build users are running is
# what makes a complaint answerable.
extension_zip="$("${root}/scripts/frontend-build.sh")"
aws s3 cp "${extension_zip}" "s3://${bucket}/extension/${label}.zip"

echo "${label}"

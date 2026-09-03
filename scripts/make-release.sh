#!/usr/bin/env bash
# Builds both halves of the product and puts them in S3. It deploys nothing: production
# is `lambda_version` in Terraform and is set there by hand — a second way to change it
# would leave Terraform's state disagreeing with reality.
#
# Prints the label the artifacts went up under. That is the value for lambda_version.
#
#   ARTIFACTS_BUCKET  where the artifacts go, mis-artifacts by default
#   EXTENSION_KEY     read by the extension build, see frontend-build.sh
set -euo pipefail

bucket="${ARTIFACTS_BUCKET:-mis-artifacts}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_build="${root}/build/backend"

# One name for both halves of one build. A version-shaped tag on HEAD makes it a release
# and the tag is the name; anything else is named by its short sha. The same rule decides
# the extension version in apps/extension/manifest.ts, so one build is called one thing
# everywhere.
label="$(git -C "${root}" tag --points-at HEAD | sed -n 's/^v\{0,1\}\([0-9][0-9.]*\)$/\1/p' | head -1)"
label="${label:-$(git -C "${root}" rev-parse --short HEAD)}"

in_bucket() {
  aws s3api head-object --bucket "${bucket}" --key "$1" >/dev/null 2>&1
}

# One commit gets built more than once — a fix to the build itself, a rebuild of a tree
# with uncommitted work in it — and an upload that quietly overwrote the previous one
# would leave the key describing something other than what sits under it. So the first
# free name wins: eb3003d, then eb3003d-1, eb3003d-2. Both halves take the same name even
# when only one of them collided: a build is one thing and has one name.
suffix=0
name="${label}"
while in_bucket "lambda/${name}.zip" || in_bucket "extension/${name}.zip"; do
  suffix=$((suffix + 1))
  name="${label}-${suffix}"
done
label="${name}"

# Each package owns a subdirectory of build/ and wipes only its own: the Lambda binary
# and the extension archive have nothing to do with each other, and a release of one must
# not take out what the other just produced.
rm -rf "${backend_build}"
mkdir -p "${backend_build}"

# provided.al2023 runs a binary named bootstrap, and that is the whole of the artifact:
# the function reads nothing from its working directory.
cd "${root}/apps/backend"
go test ./...
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o "${backend_build}/bootstrap" .

cd "${backend_build}"
zip -q "lambda-${label}.zip" bootstrap

# The extension is built by its own script, which leaves both shapes of it in
# build/extension: the zip the store takes and the unpacked folder next to it.
extension_zip="$("${root}/scripts/frontend-build.sh" "${label}")"

# Nothing goes up until both halves have been built. Uploading as we go would leave a
# Lambda in the bucket under a name whose extension does not exist, and the two are meant
# to be readable as one build.
aws s3 cp "${backend_build}/lambda-${label}.zip" "s3://${bucket}/lambda/${label}.zip"
# Terraform has no use for the extension archive; it is kept because the store does not
# hand back what was uploaded to it, and knowing which build users are running is what
# makes a complaint answerable.
aws s3 cp "${extension_zip}" "s3://${bucket}/extension/${label}.zip"

echo "${label}"

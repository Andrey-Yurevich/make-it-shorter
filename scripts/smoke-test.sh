#!/usr/bin/env bash
# Sends one real request to the deployed function and prints the SSE frames it
# streams back. Invokes the function directly rather than going through
# CloudFront, because the WAF only lets the extension's Origin through and there
# is no extension yet.
#
# Usage: smoke-test.sh <file with the request body> [function name]
set -euo pipefail

body_file="${1:?usage: smoke-test.sh <body.json> [function-name]}"
function_name="${2:-mis-api}"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# A Lambda Function URL event, the shape CloudFront would deliver.
python3 - "${body_file}" > "${work}/event.json" <<'PY'
import json, sys, uuid
body = open(sys.argv[1]).read()
json.dump({
    "version": "2.0",
    "rawPath": "/v1/summarize",
    "rawQueryString": "",
    "headers": {
        "content-type": "application/json",
        "x-device-id": str(uuid.uuid4()),
        "x-catalog-version": "1",
        "origin": "chrome-extension://smoke-test",
        "cloudfront-viewer-country": "DE",
    },
    "requestContext": {
        "domainName": "smoke-test.lambda-url.us-east-1.on.aws",
        "http": {"method": "POST", "path": "/v1/summarize", "sourceIp": "127.0.0.1"},
    },
    "body": body,
    "isBase64Encoded": False,
}, sys.stdout)
PY

# A plain Invoke against a RESPONSE_STREAM function returns the same stream,
# buffered whole. That exercises the entire pipeline but says nothing about
# whether frames arrive incrementally — that is a browser-side check against the
# real endpoint, and it is the one risk the spec wants verified early.
started=$(date +%s)
aws lambda invoke \
  --function-name "${function_name}" \
  --invocation-type RequestResponse \
  --payload "fileb://${work}/event.json" \
  --cli-binary-format raw-in-base64-out \
  "${work}/response.txt" > "${work}/meta.json"
elapsed=$(( $(date +%s) - started ))

echo "--- response in ${elapsed}s ---"
cat "${work}/response.txt"
echo
echo "--- invocation metadata ---"
cat "${work}/meta.json"

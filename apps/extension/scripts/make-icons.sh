#!/usr/bin/env bash
# Regenerates public/icons/*.png from assets/logo.svg. The PNGs are committed, so this
# only runs when the logo changes — the build must not depend on macOS being the machine
# doing it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
out="${root}/apps/extension/public/icons"

mkdir -p "${out}"
for size in 16 32 48 128; do
  sips -s format png --resampleHeightWidth "${size}" "${size}" \
    "${root}/assets/logo.svg" --out "${out}/icon${size}.png" >/dev/null
done

echo "wrote ${out}/icon{16,32,48,128}.png"

#!/usr/bin/env bash
# Builds the Chrome extension and packs it into a zip for the Chrome Web Store.
# It uploads nothing and deploys nothing: the store upload is manual, because the store
# has its own review of several days and there is nothing to automate around that.
#
# Prints the path of the zip. The version inside it comes from git: a tag on HEAD is a
# release and its name is the version, anything else is a working build named by its sha.
# manifest.ts works that out during the build, and this file reads back what it wrote.
#
#   EXTENSION_KEY   public key of the store item. Without it the unpacked build gets a
#                   random extension id, its Origin is not the one the WAF allows, and
#                   every API request comes back 403.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
extension="${root}/apps/extension"
build="${root}/build/extension"

# npm ci when there is a lockfile to obey: the artifact that goes to the store should not
# depend on whatever happens to be in node_modules today.
#
# Build chatter goes to stderr so that stdout holds the path of the zip and nothing else,
# which is what make-release.sh reads.
cd "${extension}"
if [ -f package-lock.json ]; then
  npm ci --silent >&2
else
  npm install --silent >&2
fi

# The build script is the gate, not this file: it runs the locale test (every catalog id
# has a label in all 30 locales), the type check, the unit tests, and only then the three
# Vite builds. A failure in any of them stops here.
npm run build >&2

if [ ! -f "${extension}/dist/manifest.json" ]; then
  echo "no manifest in dist: the build produced nothing to pack" >&2
  exit 1
fi

# version_name and not version: on an untagged build the latter is 0.0.0 for every
# commit, and two builds must not land on the same file name.
version="$(node -p "require('${extension}/dist/manifest.json').version_name")"
archive="${build}/extension-${version}.zip"

mkdir -p "${build}"
rm -f "${archive}"

# -X drops the extra file attributes; the store ignores them and they make two builds of
# the same tree differ for no reason. The manifest has to sit at the root of the zip,
# hence packing the contents of dist rather than dist itself.
cd "${extension}/dist"
zip -qrX "${archive}" .

echo "${archive}"

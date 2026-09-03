#!/usr/bin/env bash
# Builds the Chrome extension and packs it into a zip for the Chrome Web Store.
# It uploads nothing and deploys nothing: the store upload is manual, because the store
# has its own review of several days and there is nothing to automate around that.
#
# Leaves both shapes of the build in build/extension: the zip the store takes and the
# unpacked folder next to it. Prints the path of the zip.
#
# The name of both comes from the label: the argument if there is one — make-release.sh
# passes the name it settled on for the whole build — and otherwise the version the build
# stamped into the manifest, which is the tag on HEAD or its short sha.
#
#   EXTENSION_KEY   public key of the store item. Without it the unpacked build gets a
#                   random extension id, its Origin is not the one the WAF allows, and
#                   every API request comes back 403.
set -euo pipefail

label="${1:-}"
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
label="${label:-$(node -p "require('${extension}/dist/manifest.json').version_name")}"
archive="${build}/extension-${label}.zip"
unpacked="${build}/extension-${label}"

mkdir -p "${build}"
rm -f "${archive}"
rm -rf "${unpacked}"

# The unpacked copy is what "Load unpacked" takes, and it is kept because a zip has to be
# unpacked somewhere before it can be looked at or loaded. It is an archive of the build
# and not the development build: Chrome derives the id of an unpacked extension from the
# absolute path it was loaded from, so this copy answers to an id of its own, and the one
# the WAF admits belongs to apps/extension/dist.
cp -R "${extension}/dist" "${unpacked}"

# -X drops the extra file attributes; the store ignores them and they make two builds of
# the same tree differ for no reason. The manifest has to sit at the root of the zip,
# hence packing the contents of dist rather than dist itself.
cd "${extension}/dist"
zip -qrX "${archive}" .

echo "${archive}"

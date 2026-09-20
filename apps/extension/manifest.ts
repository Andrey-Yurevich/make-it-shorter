import { execFileSync } from "node:child_process";

// The manifest is written from here by the Vite plugin in vite.config.ts. Keeping it in
// TypeScript buys one thing only: the version is worked out here, so there is no second
// place to bump it.

// The version comes from git and from nowhere else: a tag on HEAD is a release and its
// name is the version, anything else is a working build. A number typed into
// package.json had to be remembered by hand, and a forgotten bump is a store upload
// rejected after the whole build has run.
//
// Chrome takes one to four dot-separated integers in `version` and nothing else, so a
// sha can only live in `version_name` — the free-form line chrome://extensions shows
// under the name.
const VERSION_TAG = /^v?\d+(\.\d+){0,3}$/;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: import.meta.dirname, encoding: "utf8" }).trim();
}

// Numeric, part by part: 0.10.0 is above 0.2.0, which an alphabetical sort gets wrong.
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const difference = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function buildVersion(): { version: string; versionName: string } {
  // Several tags can point at one commit — a release re-tagged under a new number with
  // the old tag left behind — and the highest version wins. A tag that does not look like
  // a version is not a release of this extension. make-release.sh applies the same rule,
  // so the archive and the manifest inside it name the same version.
  const versions = git("tag", "--points-at", "HEAD")
    .split("\n")
    .filter((candidate) => VERSION_TAG.test(candidate))
    .map((tag) => tag.replace(/^v/, ""))
    .sort(compareVersions);
  const version = versions.at(-1);

  if (version) {
    return { version, versionName: version };
  }
  // Not a release: 0.0.0 is a version the store will never accept, which is the point —
  // an untagged build is for loading unpacked, and the sha says which one it is.
  return { version: "0.0.0", versionName: git("rev-parse", "--short", "HEAD") };
}

// The public key of the Chrome Web Store item. Without it an unpacked build gets a
// random extension id, its Origin is not the one the WAF allows, and every request
// comes back 403. The build prints a warning when it is missing.
const EXTENSION_KEY = process.env.EXTENSION_KEY ?? "";

// Permissions are the smallest set that works, and activeTab rather than <all_urls> is
// the point of it: access to a tab is granted by the click on the icon, so there is no
// resident script on every page and no "read your data on all sites" warning at install.
// The price is that selections are tracked only in tabs where the icon was clicked.
// Bringing back anything that needs a resident script — a floating icon, a context menu,
// a hotkey — means bringing back <all_urls> with it.
export function buildManifest(): chrome.runtime.ManifestV3 {
  const { version, versionName } = buildVersion();

  const manifest: chrome.runtime.ManifestV3 = {
    manifest_version: 3,
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    version,
    version_name: versionName,
    icons: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
    action: {
      default_title: "__MSG_actionTitle__",
      default_icon: {
        16: "icons/icon16.png",
        32: "icons/icon32.png",
        48: "icons/icon48.png",
        128: "icons/icon128.png",
      },
    },
    side_panel: { default_path: "sidepanel.html" },
    background: { service_worker: "background.js", type: "module" },
    permissions: ["storage", "sidePanel", "activeTab", "scripting"],
    host_permissions: ["https://api.make-it-shorter.net/*"],
    // The welcome page keeps its usage examples behind a pinned icon, and only an
    // extension context can read chrome.action.getUserSettings(), so the page asks this
    // extension over chrome.runtime.sendMessage. This is the door that makes the
    // question possible, and it is as narrow as it goes: our own pages, nothing else.
    // It is not a permission and adds no install warning.
    externally_connectable: { matches: ["https://make-it-shorter.net/*"] },
  };

  if (EXTENSION_KEY) {
    manifest.key = EXTENSION_KEY;
  }
  return manifest;
}

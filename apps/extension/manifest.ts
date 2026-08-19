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

function buildVersion(): { version: string; versionName: string } {
  // Several tags can point at one commit; the first one that looks like a version wins,
  // and a tag that does not look like one is not a release of this extension.
  const tag = git("tag", "--points-at", "HEAD")
    .split("\n")
    .find((candidate) => VERSION_TAG.test(candidate));

  if (tag) {
    const version = tag.replace(/^v/, "");
    return { version, versionName: version };
  }
  // Not a release: 0.0.0 is a version the store will never accept, which is the point —
  // an untagged build is for loading unpacked, and the sha says which one it is.
  return { version: "0.0.0", versionName: git("rev-parse", "--short", "HEAD") };
}

// The public key of the Chrome Web Store item. Without it an unpacked build gets a
// random extension id, its Origin is not the one the WAF allows, and every request
// comes back 403 — see "Фиксированный ID расширения" in the spec. Empty until the item
// exists in the store; the build prints a warning when it is.
const EXTENSION_KEY = process.env.EXTENSION_KEY ?? "";

export function buildManifest(): chrome.runtime.ManifestV3 {
  const { version, versionName } = buildVersion();

  const manifest: chrome.runtime.ManifestV3 = {
    manifest_version: 3,
    name: "__MSG_extName__",
    short_name: "make it shorter",
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
    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["content.js"],
        run_at: "document_idle",
        all_frames: false,
      },
    ],
    // extract.js is pulled into the page by a dynamic import() from the content script,
    // so the page has to be allowed to load it. It carries Readability and is fetched
    // only when there is a page to extract.
    web_accessible_resources: [{ resources: ["extract.js"], matches: ["<all_urls>"] }],
    permissions: ["storage", "contextMenus", "sidePanel", "scripting"],
    host_permissions: ["https://api.make-it-shorter.net/*", "<all_urls>"],
    commands: {
      // _execute_action fires action.onClicked, so the hotkey and the toolbar icon walk
      // the same path in the service worker: both compress the whole page.
      _execute_action: {
        suggested_key: { default: "Alt+Shift+S" },
      },
    },
  };

  if (EXTENSION_KEY) {
    manifest.key = EXTENSION_KEY;
  }
  return manifest;
}

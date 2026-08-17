// The manifest is written from here by the Vite plugin in vite.config.ts. Keeping it
// in TypeScript buys one thing only: the version comes from package.json, so there is
// no second place to bump it.

// The public key of the Chrome Web Store item. Without it an unpacked build gets a
// random extension id, its Origin is not the one the WAF allows, and every request
// comes back 403 — see "Фиксированный ID расширения" in the spec. Empty until the item
// exists in the store; the build prints a warning when it is.
const EXTENSION_KEY = process.env.EXTENSION_KEY ?? "";

export function buildManifest(version: string): chrome.runtime.ManifestV3 {
  const manifest: chrome.runtime.ManifestV3 = {
    manifest_version: 3,
    name: "__MSG_extName__",
    short_name: "make it shorter",
    description: "__MSG_extDescription__",
    default_locale: "en",
    version,
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

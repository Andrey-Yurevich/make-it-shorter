import { UNINSTALL_URL, WELCOME_URL } from "@/shared/limits.ts";
import {
  PANEL_PORT,
  readExtractResult,
  readSelectionChanged,
  type ExtractRequest,
  type PanelJob,
} from "@/shared/messaging.ts";

// The service worker owns three things and nothing else: it opens the panel, it puts the
// content script into the tab, and it hands the panel what the tab held. It never talks
// to the API — the panel does that, because the panel is an ordinary document that lives
// as long as it is open, while Chrome unloads this worker whenever it feels like.

// The panel connects a port when it mounts, so the port is the panel's lifetime. Both
// are lost when the worker restarts; the panel notices its port dying and reconnects.
let panelPort: chrome.runtime.Port | null = null;
// A job that arrived before the panel connected. The panel opens before the text is
// ready, so the first click almost always lands here.
let pendingJob: PanelJob | null = null;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.tabs.create({ url: WELCOME_URL });
  }
  // Leftovers from features that are gone: dialogs with their source texts, the catalog
  // version the follow-up buttons were filtered by, the compression level the tone
  // setting replaced. The data goes with the feature rather than sitting in storage
  // forever with nothing to read it.
  void chrome.storage.local.remove(["history", "catalogVersion", "ratio"]);
});

void chrome.runtime.setUninstallURL(UNINSTALL_URL);

// openPanelOnActionClick must stay false. With it on, Chrome opens the panel itself and
// action.onClicked never fires — and then there is nowhere to start the extraction from.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
  // Older Chrome without the API. The panel still opens from the click handler below.
});

// The one entry point. A click opens the panel and reads the tab: the selection if there
// is one, otherwise the page. The text goes into the panel's field and stops there —
// nothing is sent. A second click while the panel is open reads the tab again and
// replaces the field, which is how the text is refreshed after a navigation.
chrome.action.onClicked.addListener((tab) => {
  void run(tab);
});

async function run(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) {
    return;
  }
  const tabId = tab.id;

  try {
    await chrome.sidePanel.open({ tabId });

    // activeTab was granted by the click, so the script may go into this tab now. It is
    // injected on every click: the script guards itself against running twice.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });

    const request: ExtractRequest = { type: "extract" };
    const reply: unknown = await chrome.tabs.sendMessage(tabId, request);
    const extracted = readExtractResult(reply);

    sendToPanel(
      extracted.ok
        ? { kind: "text", text: extracted.text, source: extracted.source, truncated: extracted.truncated }
        : { kind: "unreadable" },
    );
  } catch {
    // Not a page we can reach at all: chrome://, the web store, the PDF viewer, a
    // file:// tab without the permission. The panel says so, because a click that does
    // nothing and explains nothing reads as a broken extension.
    sendToPanel({ kind: "unreadable" });
  }
}

// A selection made in a tab the script is in goes into the panel's field while the panel
// is open. Nothing is sent for it: selecting text is reading, not asking, and the panel
// has a button for asking. Without the port there is no panel, and the message is
// dropped where it stands.
chrome.runtime.onMessage.addListener((message: unknown) => {
  const selection = readSelectionChanged(message);
  if (selection && panelPort) {
    panelPort.postMessage({
      type: "job",
      job: { kind: "fill", text: selection.text, truncated: selection.truncated },
    });
  }
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT) {
    return;
  }
  panelPort = port;
  port.onDisconnect.addListener(() => {
    if (panelPort === port) {
      panelPort = null;
    }
  });

  if (pendingJob) {
    port.postMessage({ type: "job", job: pendingJob });
    pendingJob = null;
  }
});

function sendToPanel(job: PanelJob): void {
  if (panelPort) {
    panelPort.postMessage({ type: "job", job });
    return;
  }
  pendingJob = job;
}

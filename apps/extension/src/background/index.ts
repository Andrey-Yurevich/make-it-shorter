import { UNINSTALL_URL, WELCOME_URL } from "@/shared/limits.ts";
import {
  PANEL_PORT,
  readExtractResult,
  readPinStateRequest,
  readReadPageRequest,
  readSelectionChanged,
  type ExtractRequest,
  type ExtractResult,
  type ExtractScope,
  type PanelJob,
  type ReadPageReply,
  type ReadPageRequest,
} from "@/shared/messaging.ts";

// The service worker owns three things and nothing else: it opens the panel, it puts the
// content script into the tab, and it hands the panel what the tab held — on the toolbar
// click, and again when the panel's "Load full page content" button asks for it. It never
// talks to the API — the panel does that, because the panel is an ordinary document that
// lives as long as it is open, while Chrome unloads this worker whenever it feels like.

// The panel connects a port when it mounts, so the port is the panel's lifetime. Both
// are lost when the worker restarts; the panel notices its port dying and reconnects.
let panelPort: chrome.runtime.Port | null = null;
// A job that arrived before the panel connected. The panel opens before the text is
// ready, so the first click almost always lands here.
let pendingJob: PanelJob | null = null;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // The welcome page keeps its examples behind a pinned icon, and it has to ask this
    // worker whether the icon is pinned — a web page cannot read that itself. Asking
    // takes an extension id, so we hand it our own rather than have the page carry a
    // hard-coded one: the store build and an unpacked build then both work, and the id
    // never has to be kept in step in two repositories.
    void chrome.tabs.create({ url: `${WELCOME_URL}?ext=${chrome.runtime.id}` });
  }
  // Leftovers from features that are gone: dialogs with their source texts, the catalog
  // version the follow-up buttons were filtered by, the compression level the tone
  // setting replaced. The data goes with the feature rather than sitting in storage
  // forever with nothing to read it.
  void chrome.storage.local.remove(["history", "catalogVersion", "ratio"]);
});

void chrome.runtime.setUninstallURL(UNINSTALL_URL);

// The welcome page asking whether the toolbar icon is pinned. This is the only thing the
// extension accepts from the open web, and externally_connectable in the manifest is
// what says who may ask: nothing here checks the sender, because the browser already
// refused every origin but ours before the listener ran.
chrome.runtime.onMessageExternal.addListener((message: unknown, _sender, sendResponse) => {
  if (readPinStateRequest(message) === null) {
    return false;
  }
  // getUserSettings arrived in Chrome 91. On anything older the question cannot be
  // answered, and an unanswered question would leave the page's button locked forever,
  // so the answer is yes and the page moves on.
  if (!chrome.action.getUserSettings) {
    sendResponse({ pinned: true });
    return false;
  }
  chrome.action.getUserSettings().then(
    (settings) => sendResponse({ pinned: settings.isOnToolbar }),
    () => sendResponse({ pinned: true }),
  );
  // The answer comes from a promise, so the channel has to stay open for it.
  return true;
});

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
    const extracted = await extractFrom(tabId, "auto");

    sendToPanel(
      extracted.ok
        ? {
            kind: "text",
            text: extracted.text,
            source: extracted.source,
            truncated: extracted.truncated,
            images: extracted.images,
          }
        : { kind: "unreadable" },
    );
  } catch {
    // Not a page we can reach at all: chrome://, the web store, the PDF viewer, a
    // file:// tab without the permission. The panel says so, because a click that does
    // nothing and explains nothing reads as a broken extension.
    sendToPanel({ kind: "unreadable" });
  }
}

// The content script into the tab, then the question. Throws when the tab is out of
// reach: no activeTab for it, or a page Chrome keeps extensions out of.
async function extractFrom(tabId: number, scope: ExtractScope): Promise<ExtractResult> {
  // activeTab was granted by the click on the icon, so the script may go into this tab.
  // It is injected every time: the script guards itself against running twice.
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });

  const request: ExtractRequest = { type: "extract", scope };
  const reply: unknown = await chrome.tabs.sendMessage(tabId, request);
  return readExtractResult(reply);
}

// The "Load full page content" button: the whole of the tab the user is looking at, whatever
// is selected on it. The tab is the active one of the panel's window, which the panel
// names; a panel that could not name it gets the last focused window instead. activeTab
// is not granted by a click in the panel — only the toolbar icon grants it — so a tab
// the icon was never clicked on, or one that navigated since, is out of reach, and the
// panel says to click the icon first.
async function readPage(request: ReadPageRequest): Promise<ReadPageReply> {
  try {
    const [tab] = await chrome.tabs.query(
      request.windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId: request.windowId },
    );
    if (tab?.id === undefined) {
      console.warn("read-page: no active tab", request);
      return { ok: false, reason: "no-access" };
    }
    const extracted = await extractFrom(tab.id, "page");
    if (!extracted.ok) {
      return { ok: false, reason: "no-text" };
    }
    return { ok: true, text: extracted.text, truncated: extracted.truncated, images: extracted.images };
  } catch (error) {
    // The one place a human can see why the button said no: the worker's console.
    console.warn("read-page: tab out of reach", error);
    return { ok: false, reason: "no-access" };
  }
}

// Two things arrive here. The panel asking for the page, which is answered. And a
// selection made in a tab the script is in, which goes into the panel's field while the
// panel is open. Nothing is sent for either — reading is not asking, and the panel has a
// button for asking. Without the port there is no panel, and the selection is dropped
// where it stands.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const pageRequest = readReadPageRequest(message);
  if (pageRequest) {
    void readPage(pageRequest).then(sendResponse);
    // The answer comes from a promise, so the channel has to stay open for it.
    return true;
  }

  const selection = readSelectionChanged(message);
  if (selection && panelPort) {
    panelPort.postMessage({
      type: "job",
      job: { kind: "fill", text: selection.text, truncated: selection.truncated, images: selection.images },
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

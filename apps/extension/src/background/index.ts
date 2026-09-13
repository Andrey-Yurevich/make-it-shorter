import { UNINSTALL_URL, WELCOME_URL } from "../shared/limits.ts";
import {
  PANEL_PORT,
  readSelectionChanged,
  readSelectionMessage,
  type PanelJob,
} from "../shared/messaging.ts";
import { extractFromTab } from "../shared/tab.ts";

// The service worker owns three things and nothing else: it opens the panel, it decides
// what is going to be compressed, and it gets the text out of the tab. It never talks
// to the API — the panel does that, because the panel is an ordinary document that
// lives as long as it is open, while Chrome unloads this worker whenever it feels like.

// The panel connects a port when it mounts, so the port is the panel's lifetime. Both
// are lost when the worker restarts; the panel notices its port dying and reconnects,
// and a lost state only ever costs one extra request.
let panelPort: chrome.runtime.Port | null = null;
let pendingJob: PanelJob | null = null;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: WELCOME_URL });
  }
  // removeAll first: onInstalled also fires on update, and creating an id that already
  // exists is an error.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "summarize-selection",
      title: chrome.i18n.getMessage("contextMenuSelection"),
      contexts: ["selection"],
    });
  });
  // Leftovers from features that are gone: up to fifty dialogs with their source
  // texts, the catalog version the follow-up buttons were filtered by, and the
  // compression level that the tone setting replaced. The data goes with the feature
  // rather than sitting in storage forever with nothing to read it.
  void chrome.storage.local.remove(["history", "catalogVersion", "ratio"]);
});

chrome.runtime.setUninstallURL(UNINSTALL_URL);

// openPanelOnActionClick must stay false. With it on, Chrome opens the panel itself and
// action.onClicked never fires — and then there is nowhere to start the extraction from.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
  // Older Chrome without the API. The panel still opens from the click handler below.
});

// Every entry point into the worker shortens the selection, and none of them shortens
// the whole page. The toolbar icon and the hotkey behind _execute_action included: with
// something selected they shorten that, and with nothing selected they only open the
// panel and spend nothing.
//
// A whole page is the most expensive thing this extension can be asked for — with the
// follow-ups pre-generated, one request is not loose change — and it is now asked for in
// exactly one place, in so many words: the panel's own "Shorten entire page content".
// The icon used to do it on every click, which meant the most visible control in the
// extension spent a request out of the daily quota whether or not anybody had asked for
// a summary of that page.
chrome.action.onClicked.addListener((tab) => {
  void run(tab);
});

chrome.contextMenus.onClicked.addListener((_info, tab) => {
  if (tab) {
    void run(tab);
  }
});

// The floating icon in the page. The click that produced this message is the user
// gesture sidePanel.open() insists on; the gesture survives the hop through the
// message, and the spec flags this as the thing to verify first on a real browser. If
// it ever stops working, the fallback is to open the panel from the toolbar only and
// let the floating icon hand text to a panel that is already open.
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (readSelectionMessage(message) && sender.tab?.id !== undefined) {
    void run(sender.tab);
    return false;
  }

  // A selection made while the panel is open goes into its input field. The panel is
  // not opened for it and nothing is sent: without the port there is no panel, and the
  // message is dropped where it stands.
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
    panelPort = null;
  });

  // The panel opens before the text is ready, so a job that arrived first waits here.
  if (pendingJob) {
    port.postMessage({ type: "job", job: pendingJob });
    pendingJob = null;
  }
});

async function run(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) {
    return;
  }

  await chrome.sidePanel.open({ tabId: tab.id });

  const extracted = await extractFromTab(tab.id, "selection");

  // Not a page we can reach at all: chrome://, the web store, the PDF viewer, a tab
  // older than the extension. The panel says so, because a click that does nothing and
  // explains nothing reads as a broken extension.
  if (!extracted.ok) {
    sendToPanel({ kind: "unreadable", tabId: tab.id });
    return;
  }

  // Nothing is selected, and opening the panel is all this click asked for. The field
  // keeps whatever the user had put in it — sending an empty job here would wipe text
  // they pasted by hand, which is the one thing a click on the toolbar must never do.
  if (extracted.text === "") {
    return;
  }

  sendToPanel({
    kind: "text",
    text: extracted.text,
    source: "selection",
    truncated: extracted.truncated,
  });
}

function sendToPanel(job: PanelJob): void {
  if (panelPort) {
    panelPort.postMessage({ type: "job", job });
    return;
  }
  pendingJob = job;
}

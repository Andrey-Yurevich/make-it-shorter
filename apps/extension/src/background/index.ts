import { UNINSTALL_URL, WELCOME_URL } from "../shared/limits.ts";
import { PANEL_PORT, type PanelJob, type PanelState } from "../shared/messaging.ts";
import { rememberCatalogVersion } from "../shared/storage.ts";
import { extractFromTab } from "../shared/tab.ts";

// The service worker owns three things and nothing else: it opens the panel, it decides
// what is going to be compressed, and it gets the text out of the tab. It never talks
// to the API — the panel does that, because the panel is an ordinary document that
// lives as long as it is open, while Chrome unloads this worker whenever it feels like.

// The panel connects a port when it mounts, so the port is the panel's lifetime. Both
// are lost when the worker restarts; the panel notices its port dying and reconnects,
// and a lost state only ever costs one extra request.
let panelPort: chrome.runtime.Port | null = null;
let panelState: PanelState = { type: "state", pageUrl: null, hasSummary: false };
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
  void rememberCatalogVersion(__CATALOG_VERSION__);
  // Installs from before the panel dropped its history still hold up to fifty dialogs,
  // source texts included. The feature is gone, so the data goes with it rather than
  // sitting in storage forever with nothing to read it.
  void chrome.storage.local.remove("history");
});

chrome.runtime.setUninstallURL(UNINSTALL_URL);

// openPanelOnActionClick must stay false. With it on, Chrome opens the panel itself and
// action.onClicked never fires — and then there is nowhere to start the extraction from.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
  // Older Chrome without the API. The panel still opens from the click handler below.
});

// The toolbar icon, and the hotkey through _execute_action, compress the whole page.
// Selection has two entry points of its own, both within reach; making the most visible
// control depend on invisible state would make its behaviour unpredictable.
chrome.action.onClicked.addListener((tab) => {
  void run(tab, "page");
});

chrome.contextMenus.onClicked.addListener((_info, tab) => {
  if (tab) {
    void run(tab, "selection");
  }
});

// The floating icon in the page. The click that produced this message is the user
// gesture sidePanel.open() insists on; the gesture survives the hop through the
// message, and the spec flags this as the thing to verify first on a real browser. If
// it ever stops working, the fallback is to open the panel from the toolbar only and
// let the floating icon hand text to a panel that is already open.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "selection-clicked" && sender.tab?.id !== undefined) {
    void run(sender.tab, "selection");
  }
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT) {
    return;
  }
  panelPort = port;
  port.onMessage.addListener((message: PanelState) => {
    if (message.type === "state") {
      panelState = message;
    }
  });
  port.onDisconnect.addListener(() => {
    panelPort = null;
    panelState = { type: "state", pageUrl: null, hasSummary: false };
  });

  // The panel opens before the text is ready, so a job that arrived first waits here.
  if (pendingJob) {
    port.postMessage({ type: "job", job: pendingJob });
    pendingJob = null;
  }
});

async function run(tab: chrome.tabs.Tab, mode: "page" | "selection"): Promise<void> {
  if (tab.id === undefined) {
    return;
  }

  // A second click on the icon while the panel already holds a summary of this very
  // page just focuses the panel. Without the rule, opening the panel to reread a summary
  // would burn a request from the daily quota and real money — with answers generated
  // upfront a request is not cheap. Rereading the page on purpose is what the refresh
  // button in the panel is for.
  const repeatOnSamePage =
    mode === "page" && panelPort !== null && panelState.hasSummary && panelState.pageUrl === tab.url;

  await chrome.sidePanel.open({ tabId: tab.id });
  if (repeatOnSamePage) {
    return;
  }

  const extracted = await extractFromTab(tab.id, mode);
  const job: PanelJob = extracted.ok
    ? { kind: "text", text: extracted.text, source: mode, truncated: extracted.truncated, pageUrl: tab.url }
    : { kind: "unreadable", pageUrl: tab.url };

  sendToPanel(job);
}

function sendToPanel(job: PanelJob): void {
  if (panelPort) {
    panelPort.postMessage({ type: "job", job });
    return;
  }
  pendingJob = job;
}

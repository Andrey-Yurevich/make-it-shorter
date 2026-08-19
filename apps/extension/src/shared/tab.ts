import type { ExtractMode, ExtractResult } from "./messaging.ts";

// Getting the text out of a tab. Both the service worker (icon, context menu) and the
// panel (the refresh button) do it, and they do it the same way, so it lives here
// rather than being written twice.

export async function activeTab(): Promise<chrome.tabs.Tab | null> {
  // lastFocusedWindow, not currentWindow: the side panel is a document of its own, and
  // from inside it "current" is the panel's window, not the browser window the user is
  // looking at.
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

// Tabs that were open before the extension was installed or updated hold no content
// script, and sendMessage fails there with "Receiving end does not exist" — that is what
// the scripting permission is for. Without this the extension looks broken right after
// installation until the tab is reloaded, and the user files that as a defect.
export async function extractFromTab(tabId: number, mode: ExtractMode): Promise<ExtractResult> {
  try {
    return await chrome.tabs.sendMessage<unknown, ExtractResult>(tabId, { type: "extract", mode });
  } catch {
    // Nothing here, so try to put it there.
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage<unknown, ExtractResult>(tabId, { type: "extract", mode });
  } catch {
    // A restricted page: chrome://, the web store, the PDF viewer, file:// without the
    // checkbox. Not an error and not reported as one — the panel says the page could not
    // be read and waits for the next thing the user does.
    return { ok: false };
  }
}

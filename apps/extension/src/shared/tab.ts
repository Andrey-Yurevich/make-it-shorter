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
    return asExtractResult(await chrome.tabs.sendMessage<unknown, unknown>(tabId, { type: "extract", mode }));
  } catch {
    // Nothing here, so try to put it there.
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return asExtractResult(await chrome.tabs.sendMessage<unknown, unknown>(tabId, { type: "extract", mode }));
  } catch {
    // A restricted page: chrome://, the web store, the PDF viewer, file:// without the
    // checkbox. Not an error and not reported as one — the panel says the page could not
    // be read and waits for the next thing the user does.
    return { ok: false };
  }
}

// The reply comes from a script running in a page we do not control, and it is the only
// value in the extension that nothing else has checked. Two things arrive here that are
// not an ExtractResult, and neither of them throws on the way:
//
//   - sendMessage resolves with undefined when no listener answered at all;
//   - a content script from an older build, left in a tab that stayed open across a
//     reload, answers in the shape it had then.
//
// Both used to travel on as ok with no text, and undefined reached the input field. From
// there every render threw while counting the length of it, React unmounted the panel,
// and it stayed blank long after the message that broke it — so the shape is settled
// here, once, where the value enters. An answer we cannot read is a page we cannot read.
function asExtractResult(reply: unknown): ExtractResult {
  const result = reply as ExtractResult | undefined;
  if (result?.ok === true && typeof result.text === "string") {
    return { ok: true, text: result.text, truncated: result.truncated === true };
  }
  return { ok: false };
}

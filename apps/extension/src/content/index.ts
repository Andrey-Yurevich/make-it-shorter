import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { MIN_INPUT } from "@/shared/limits.ts";
import { readExtractRequest, type ExtractResult, type SelectionChangedMessage } from "@/shared/messaging.ts";
import { countCodePoints, normalizeText } from "@/shared/text.ts";

// The content script. It is not resident: the service worker injects it into the active
// tab when the toolbar icon is clicked, and nowhere else. It does two things — answers
// `extract` with the selection or the page, and reports selections made afterwards.
//
// Injected once per click, so it may land in a tab that already has it. The flag on
// window keeps the second copy from adding a second set of listeners; the first copy's
// listeners keep answering.

declare global {
  interface Window {
    __makeItShorterInjected?: boolean;
  }
}

if (!window.__makeItShorterInjected) {
  window.__makeItShorterInjected = true;

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!readExtractRequest(message)) {
      return false;
    }
    sendResponse(extract());
    return false;
  });

  document.addEventListener("selectionchange", onSelectionChange);
}

// The selection when there is one, the page when there is not. Dirty text is an
// acceptable result: what is content and what is furniture is decided by Readability on
// the DOM, where link density and markup are still available, never on the flat string.
function extract(): ExtractResult {
  const selection = normalizeText(window.getSelection()?.toString() ?? "");
  if (selection.text !== "") {
    return { ok: true, text: selection.text, source: "selection", truncated: selection.truncated };
  }

  // The cheap question first: is there an article-shaped body of text on this page at
  // all? A search results page, a dashboard, a feed of cards say no here. Sending their
  // visible text would spend a request and come back as nothing_to_shorten — or worse,
  // as a "shorter" version of forty site descriptions.
  if (!isProbablyReaderable(document)) {
    return { ok: false };
  }

  // Readability mutates the document it is given, so it gets a copy.
  const article = new Readability(document.cloneNode(true) as Document).parse();
  let raw = article?.textContent ?? "";
  if (raw.trim() === "") {
    // The page looked readable and Readability still declined — a forum thread, a long
    // comment section. The visible text is a worse but honest fallback.
    raw = document.body?.innerText ?? "";
  }

  const page = normalizeText(raw);
  if (page.text === "") {
    return { ok: false };
  }
  return { ok: true, text: page.text, source: "page", truncated: page.truncated };
}

// Selections made while the panel is open go into its field. Debounced: selectionchange
// fires on every mouse move of a drag.
const SELECTION_DEBOUNCE_MS = 300;
let selectionTimer: ReturnType<typeof setTimeout> | undefined;

function onSelectionChange(): void {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(reportSelection, SELECTION_DEBOUNCE_MS);
}

function reportSelection(): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || isEditing(selection)) {
    return;
  }

  // Below the minimum there is nothing to shorten anyway, and picking up every stray
  // word would overwrite text the user had put in the field by hand.
  const normalized = normalizeText(selection.toString());
  if (countCodePoints(normalized.text) < MIN_INPUT) {
    return;
  }

  const message: SelectionChangedMessage = {
    type: "selection-changed",
    text: normalized.text,
    truncated: normalized.truncated,
  };
  try {
    // The worker drops the message when the panel is not open, so nothing here depends
    // on knowing that. The extension may also have been reloaded since this script was
    // injected, and then the call throws or rejects; the page must not see an error for it.
    void chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // Extension context invalidated.
  }
}

// Not in inputs and not in contenteditable: a selection there usually means editing,
// not reading.
function isEditing(selection: Selection): boolean {
  const editable = "input, textarea, [contenteditable]";
  if (document.activeElement?.closest(editable)) {
    return true;
  }
  const anchor = selection.anchorNode;
  const element = anchor instanceof Element ? anchor : anchor?.parentElement;
  return element?.closest(editable) !== null && element?.closest(editable) !== undefined;
}

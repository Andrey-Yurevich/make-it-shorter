import type { Source } from "./protocol.ts";

// Messages between the three surfaces. The content script only ever extracts text; the
// service worker only ever decides what to extract and opens the panel; the panel does
// the network. Nothing here carries a summary.

export type ExtractMode = "selection" | "page";

// service worker → content script
export type ExtractRequest = {
  type: "extract";
  mode: ExtractMode;
};

export type ExtractResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false };

// content script → service worker, when the floating icon is clicked
export type SelectionMessage = {
  type: "selection-clicked";
  text: string;
};

// content script → service worker, whenever a selection is made in a page. The worker
// forwards it only while the panel is open and drops it otherwise, so the content script
// does not have to know whether anybody is listening.
export type SelectionChangedMessage = {
  type: "selection-changed";
  text: string;
  truncated: boolean;
};

// What the panel is asked to work on. `kind: "unreadable"` is the page we could not
// read — a restricted page, or a page that came back with no text at all. That is not an
// error: the panel says so and waits for the next thing the user does.
//
// It carries the tab rather than the url, and the tab is the whole point of it: the
// panel disables its read-the-page button while the message is up, and has to know
// which tab the message is about so it can drop it when the user moves to another one.
// The url would not do — Chrome withholds it on exactly the pages that produce this
// message, since `<all_urls>` does not match `chrome://`.
//
// `kind: "fill"` is a selection the user made in the page while the panel was open. It
// only puts text in the field: nothing is sent, and no request is spent. Selecting text
// is reading, not asking, and the panel has a button for asking.
export type PanelJob =
  | { kind: "text"; text: string; source: Source; truncated: boolean; pageUrl?: string }
  | { kind: "fill"; text: string; truncated: boolean }
  | { kind: "unreadable"; tabId?: number };

// panel → service worker, over the long-lived port. The worker needs it for one rule:
// a second click on the toolbar icon while the panel already holds a summary of this
// very page only focuses the panel and spends nothing.
export type PanelState = {
  type: "state";
  pageUrl: string | null;
  hasSummary: boolean;
};

// service worker → panel, over the same port
export type PanelMessage = { type: "job"; job: PanelJob };

export const PANEL_PORT = "panel";

// Everything above crosses a process boundary, and on the far side of one there is no
// such thing as a type — only whatever the sender happened to post. The readers below
// are the only way a message enters the extension: each takes `unknown`, returns the
// shape it understands, and never throws.
//
// This is not defensive habit, it is the bug that cost two days. The panel annotated its
// port listener with PanelMessage, which told the compiler to stop looking; a job with
// no text put `undefined` in the input field, and every render after it threw while
// counting the length of that. React unmounted the panel, and it stayed blank long after
// the message that broke it. scripts/check-boundaries.mjs now keeps every listener
// parameter at `unknown`, so the compiler cannot be told to skip this step again.

function isSource(value: unknown): value is Source {
  return value === "selection" || value === "page" || value === "manual";
}

// service worker → panel. Returns null for anything that is not a job, which the panel
// ignores; a job it cannot read comes back as `unreadable`, because that is what it is.
// Silently dropping a malformed job would leave the panel waiting for text that is
// never coming, with nothing on screen to say so.
export function readPanelMessage(message: unknown): PanelJob | null {
  const envelope = message as { type?: unknown; job?: unknown } | null | undefined;
  if (envelope?.type !== "job") {
    return null;
  }

  const job = envelope.job as Record<string, unknown> | null | undefined;

  if (job?.kind === "fill" && typeof job.text === "string") {
    return { kind: "fill", text: job.text, truncated: job.truncated === true };
  }

  if (job?.kind === "text" && typeof job.text === "string") {
    const pageUrl = typeof job.pageUrl === "string" ? job.pageUrl : undefined;
    return {
      kind: "text",
      text: job.text,
      // A source we do not recognise still describes a page: it only picks the wording
      // of the request, and getting it wrong costs nothing a user can see.
      source: isSource(job.source) ? job.source : "page",
      truncated: job.truncated === true,
      pageUrl,
    };
  }
  // No tab id is a message that expires on the first tab switch instead of on the right
  // one. That is the safe direction: the button comes back sooner than it had to, rather
  // than staying dead on a tab the message was never about.
  return { kind: "unreadable", tabId: typeof job?.tabId === "number" ? job.tabId : undefined };
}

// panel → service worker. A state that cannot be read is dropped: the worker's copy
// keeps its previous value, and the only thing that rides on it is whether a second
// click on the icon re-reads the page. Worst case it re-reads one it need not have.
export function readPanelState(message: unknown): PanelState | null {
  const state = message as Record<string, unknown> | null | undefined;
  if (state?.type !== "state") {
    return null;
  }
  return {
    type: "state",
    pageUrl: typeof state.pageUrl === "string" ? state.pageUrl : null,
    hasSummary: state.hasSummary === true,
  };
}

// service worker → content script.
export function readExtractRequest(message: unknown): ExtractRequest | null {
  const request = message as Record<string, unknown> | null | undefined;
  if (request?.type !== "extract") {
    return null;
  }
  if (request.mode !== "selection" && request.mode !== "page") {
    return null;
  }
  return { type: "extract", mode: request.mode };
}

// content script → service worker.
export function readSelectionMessage(message: unknown): SelectionMessage | null {
  const selection = message as Record<string, unknown> | null | undefined;
  if (selection?.type !== "selection-clicked") {
    return null;
  }
  return { type: "selection-clicked", text: typeof selection.text === "string" ? selection.text : "" };
}

// content script → service worker. A message with no text is not a selection worth
// forwarding, so it comes back null and the field keeps what it holds.
export function readSelectionChanged(message: unknown): SelectionChangedMessage | null {
  const selection = message as Record<string, unknown> | null | undefined;
  if (selection?.type !== "selection-changed" || typeof selection.text !== "string") {
    return null;
  }
  if (selection.text === "") {
    return null;
  }
  return { type: "selection-changed", text: selection.text, truncated: selection.truncated === true };
}

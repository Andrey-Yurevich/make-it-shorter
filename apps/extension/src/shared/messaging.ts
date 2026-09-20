// Messages between the three surfaces. The content script only ever extracts text; the
// service worker only ever opens the panel and gets the text out of the tab; the panel
// does the network. Nothing here carries a result.

// service worker → content script
export type ExtractRequest = { type: "extract" };

// A picture the extraction found, numbered from one in document order. The text carries
// only the number, as "{{img:1}}"; the address stays in this table, travels between the
// extension's own surfaces and is never sent anywhere. The panel puts the two back
// together when it renders the result.
export type ExtractedImage = { id: number; src: string; alt: string };

// content script → service worker, the reply to `extract`. `ok: false` is a page with
// nothing to read: no selection and no article-shaped body of text.
export type ExtractResult =
  | { ok: true; text: string; source: "selection" | "page"; truncated: boolean; images: ExtractedImage[] }
  | { ok: false };

// content script → service worker, whenever a selection worth shortening is made in the
// page. The worker forwards it only while the panel is open and drops it otherwise, so
// the content script does not have to know whether anybody is listening.
export type SelectionChangedMessage = {
  type: "selection-changed";
  text: string;
  truncated: boolean;
  images: ExtractedImage[];
};

// welcome page → service worker. The page on make-it-shorter.net cannot read
// chrome.action.getUserSettings() itself — only an extension context can — so it asks
// for the one thing it needs: whether the toolbar icon is pinned. The manifest's
// externally_connectable is what limits who may ask.
export type PinStateRequest = { type: "pin-state" };

// service worker → welcome page, the reply. `pinned` is the answer, and on a Chrome too
// old for getUserSettings it is `true`: an unanswerable question must not leave the page
// with a button that never unlocks.
export type PinStateReply = { pinned: boolean };

// What the panel is asked to work on.
//
// `text` is what a click on the toolbar icon read from the tab: the selection, or the
// whole page. `fill` is a selection made while the panel was open. Both only put text in
// the field: nothing is sent and no request is spent — the Shorten button is how the
// user asks. `unreadable` is a page we could not read: a restricted page, or one with
// no text on it. That is not an error; the panel says so and waits.
export type PanelJob =
  | { kind: "text"; text: string; source: "selection" | "page"; truncated: boolean; images: ExtractedImage[] }
  | { kind: "fill"; text: string; truncated: boolean; images: ExtractedImage[] }
  | { kind: "unreadable" };

// service worker → panel, over the port. Nothing travels the other way.
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

function isPageSource(value: unknown): value is "selection" | "page" {
  return value === "selection" || value === "page";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The picture table, entry by entry. An entry the panel cannot use is left behind rather
// than repaired: the marker that pointed at it renders as nothing, which is what a
// missing picture should look like. Absent or malformed altogether is an empty table —
// text with markers and no pictures still reads.
//
// `src` has to be an https URL, and that is checked here as well as where it was built:
// this reader is the last thing between a string from another process and an <img> the
// panel asks the network for.
export function readExtractedImages(value: unknown): ExtractedImage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: ExtractedImage[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.alt !== "string") {
      continue;
    }
    if (typeof entry.id !== "number" || !Number.isInteger(entry.id)) {
      continue;
    }
    if (typeof entry.src !== "string" || !entry.src.startsWith("https://")) {
      continue;
    }
    images.push({ id: entry.id, src: entry.src, alt: entry.alt });
  }
  return images;
}

// service worker → panel. Returns null for anything that is not a job, which the panel
// ignores; a job it cannot read comes back as `unreadable`, because that is what it is.
// Silently dropping a malformed job would leave the panel waiting for text that is
// never coming, with nothing on screen to say so.
export function readPanelMessage(message: unknown): PanelJob | null {
  if (!isRecord(message) || message.type !== "job") {
    return null;
  }
  const job = message.job;
  if (!isRecord(job)) {
    return { kind: "unreadable" };
  }

  if (job.kind === "fill" && typeof job.text === "string") {
    return {
      kind: "fill",
      text: job.text,
      truncated: job.truncated === true,
      images: readExtractedImages(job.images),
    };
  }
  if (job.kind === "text" && typeof job.text === "string") {
    return {
      kind: "text",
      text: job.text,
      // A source we do not recognise still describes a page: it only picks the wording
      // of the request, and getting it wrong costs nothing a user can see.
      source: isPageSource(job.source) ? job.source : "page",
      truncated: job.truncated === true,
      images: readExtractedImages(job.images),
    };
  }
  return { kind: "unreadable" };
}

// service worker → content script.
export function readExtractRequest(message: unknown): ExtractRequest | null {
  return isRecord(message) && message.type === "extract" ? { type: "extract" } : null;
}

// content script → service worker, the reply to `extract`. Anything that is not a
// well-formed success — including `undefined`, which is what sendMessage resolves to
// when nothing in the tab answered — is a page that could not be read.
export function readExtractResult(reply: unknown): ExtractResult {
  if (!isRecord(reply) || reply.ok !== true || typeof reply.text !== "string") {
    return { ok: false };
  }
  return {
    ok: true,
    text: reply.text,
    source: isPageSource(reply.source) ? reply.source : "page",
    truncated: reply.truncated === true,
    images: readExtractedImages(reply.images),
  };
}

// welcome page → service worker. Anything else on this listener is not ours: the page is
// on the open web and the listener is reachable from every page of the domain.
export function readPinStateRequest(message: unknown): PinStateRequest | null {
  return isRecord(message) && message.type === "pin-state" ? { type: "pin-state" } : null;
}

// content script → service worker. A message with no text is not a selection worth
// forwarding, so it comes back null and the field keeps what it holds.
export function readSelectionChanged(message: unknown): SelectionChangedMessage | null {
  if (!isRecord(message) || message.type !== "selection-changed" || typeof message.text !== "string") {
    return null;
  }
  if (message.text === "") {
    return null;
  }
  return {
    type: "selection-changed",
    text: message.text,
    truncated: message.truncated === true,
    images: readExtractedImages(message.images),
  };
}

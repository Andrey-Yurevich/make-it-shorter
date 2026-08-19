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

// What the panel is asked to work on. `kind: "unreadable"` is the page we could not
// read — a restricted page, or a page Readability came back from with less than
// minInput. That is not an error: the panel says so and waits for the next thing the
// user does.
export type PanelJob =
  | { kind: "text"; text: string; source: Source; truncated: boolean; pageUrl?: string }
  | { kind: "unreadable"; pageUrl?: string };

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

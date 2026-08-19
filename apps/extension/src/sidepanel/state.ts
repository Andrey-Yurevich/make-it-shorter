import type { ErrorCode, Source } from "../shared/protocol.ts";

// The whole panel is this one state machine, and it is deliberately small: a text on the
// way in, a text on the way out, and whether anything is still moving. There is no
// history behind it and no second screen over it.
export type RunState = {
  // What the input field holds. The user types into it, the page and the selection fill
  // it, and it is what gets sent — there is no other copy of the source text.
  input: string;
  // The page or the selection was longer than the server accepts and was cut on the way
  // in. The field holds the cut text, so the panel says so rather than let it look
  // complete.
  truncated: boolean;
  // Where the text in the field came from. It travels with the request and it is what a
  // retry repeats.
  source: Source;
  // The page the text was read from, for the worker's "second click on the icon" rule.
  pageUrl: string | null;
  result: string;
  streaming: boolean;
  error: { code: ErrorCode; message?: string } | null;
  // The page could not be read: a restricted page, or nothing worth reading on it. Not
  // an error — the panel says so and waits for the next thing the user does.
  unreadablePage: boolean;
};

export const initialRunState: RunState = {
  input: "",
  truncated: false,
  source: "manual",
  pageUrl: null,
  result: "",
  streaming: false,
  error: null,
  unreadablePage: false,
};

export type RunAction =
  | { type: "edit"; text: string }
  | { type: "reading" }
  | { type: "loaded"; text: string; source: Source; truncated: boolean; pageUrl?: string }
  | { type: "start" }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; code: ErrorCode; message?: string }
  | { type: "unreadable-page" };

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    // Typing into the field is the user acting on the last message shown, so the message
    // goes. The text they edit becomes their own — a retry after this sends what is in
    // the field, not what the page once held.
    case "edit":
      return {
        ...state,
        input: action.text,
        source: "manual",
        // Whatever is on screen is no longer this page's, so a second click on the
        // toolbar icon reads the page again instead of just focusing the panel.
        pageUrl: null,
        error: null,
        unreadablePage: false,
      };

    // The tab is being read and there is no text yet. The wait for the extraction and
    // the wait for the first token are one wait to the user, so they look the same here.
    case "reading":
      return { ...state, result: "", streaming: true, error: null, unreadablePage: false };

    case "loaded":
      return {
        ...state,
        input: action.text,
        truncated: action.truncated,
        source: action.source,
        pageUrl: action.pageUrl ?? null,
        result: "",
        streaming: false,
        error: null,
        unreadablePage: false,
      };

    case "start":
      return { ...state, result: "", streaming: true, error: null, unreadablePage: false };

    case "delta":
      return { ...state, result: state.result + action.text };

    case "done":
      return { ...state, streaming: false };

    case "error":
      return { ...state, streaming: false, error: { code: action.code, message: action.message } };

    // The input field keeps whatever it held: a page that cannot be read is no reason to
    // throw away text the user pasted there.
    case "unreadable-page":
      return { ...state, result: "", streaming: false, error: null, unreadablePage: true };
  }
}

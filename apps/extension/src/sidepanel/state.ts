import type { ErrorCode } from "../shared/protocol.ts";
import type { Dialog } from "../shared/storage.ts";

// The whole panel is this one state machine. Buttons appear before their texts and sit
// disabled for a few seconds — that is the normal course of events, not a hang.

export type RunState = {
  dialog: Dialog | null;
  // Ids announced by `actions` that have no `answer` yet. Their buttons are visible and
  // disabled.
  pending: string[];
  streaming: boolean;
  error: { code: ErrorCode; message?: string } | null;
  // The page could not be read: a restricted page, or too little text. Not an error —
  // the panel just says so and waits for pasted text.
  unreadablePage: boolean;
};

export const initialRunState: RunState = {
  dialog: null,
  pending: [],
  streaming: false,
  error: null,
  unreadablePage: false,
};

export type RunAction =
  | { type: "start"; dialog: Dialog }
  | { type: "delta"; text: string }
  | { type: "actions"; ids: string[] }
  | { type: "answer"; id: string; text: string }
  | { type: "done" }
  | { type: "error"; code: ErrorCode; message?: string }
  | { type: "unreadable-page" }
  | { type: "open"; dialog: Dialog }
  | { type: "reset" };

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "start":
      return { dialog: action.dialog, pending: [], streaming: true, error: null, unreadablePage: false };

    case "delta":
      // The summary is written by deltas and by nothing else; answer texts never arrive
      // this way.
      return withDialog(state, (dialog) => ({ ...dialog, summary: dialog.summary + action.text }));

    case "actions":
      // An empty list is a valid result, not a failure: nothing here worth expanding.
      // Nothing is substituted for it.
      return {
        ...withDialog(state, (dialog) => ({
          ...dialog,
          actions: action.ids.map((id) => ({ id, text: "" })),
        })),
        pending: action.ids,
      };

    case "answer":
      return {
        ...withDialog(state, (dialog) => ({
          ...dialog,
          actions: dialog.actions.map((entry) =>
            entry.id === action.id ? { ...entry, text: action.text } : entry,
          ),
        })),
        pending: state.pending.filter((id) => id !== action.id),
      };

    // `done` is the reconciliation point. An id that came in `actions` and never got its
    // `answer` is dropped here: the server reports a failed expansion with no event of
    // its own, so this is the only moment it becomes clear that it is not coming. Skip
    // the step and you keep a button that can never be pressed.
    case "done":
      return { ...dropUnanswered(state), streaming: false };

    case "error":
      return {
        ...dropUnanswered(state),
        streaming: false,
        error: { code: action.code, message: action.message },
      };

    case "unreadable-page":
      return { ...initialRunState, unreadablePage: true };

    case "open":
      // Out of the history: fully working, every button live, no network needed.
      return { dialog: action.dialog, pending: [], streaming: false, error: null, unreadablePage: false };

    case "reset":
      return initialRunState;
  }
}

function withDialog(state: RunState, update: (dialog: Dialog) => Dialog): RunState {
  if (!state.dialog) {
    return state;
  }
  return { ...state, dialog: update(state.dialog) };
}

function dropUnanswered(state: RunState): RunState {
  return {
    ...withDialog(state, (dialog) => ({
      ...dialog,
      actions: dialog.actions.filter((entry) => entry.text !== ""),
    })),
    pending: [],
  };
}

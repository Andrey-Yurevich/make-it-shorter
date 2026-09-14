import type { PanelJob } from "@/shared/messaging.ts";
import type { ErrorCode, Source } from "@/shared/protocol.ts";

// The whole panel is this one reducer, and it is deliberately small: a text on the way
// in, a text on the way out, and whether anything is still moving. There is no history
// behind it and no second screen over it.
export type PanelState = {
  // What the input field holds. The user types into it, the page and the selection fill
  // it, and it is what gets sent — there is no other copy of the source text.
  input: string;
  // The page or the selection was longer than the server accepts and was cut on the way
  // in. The field holds the cut text, so the panel says so rather than let it look
  // complete.
  truncated: boolean;
  // Where the text in the field came from. It travels with the request.
  source: Source;
  // The result as markdown, accumulated delta by delta.
  result: string;
  streaming: boolean;
  error: { code: ErrorCode; message?: string } | null;
  // The page could not be read: a restricted page, or nothing worth reading on it. Not
  // an error — a hint under the field, until the user types or another job arrives.
  unreadable: boolean;
  // Counts the runs started, so that the output area can reset its scroll on each one.
  run: number;
};

export const initialPanelState: PanelState = {
  input: "",
  truncated: false,
  source: "manual",
  result: "",
  streaming: false,
  error: null,
  unreadable: false,
  run: 0,
};

export type PanelAction =
  | { type: "edit"; text: string }
  | { type: "job"; job: PanelJob }
  | { type: "start" }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; code: ErrorCode; message?: string };

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    // Typing into the field is the user acting on the last message shown, so the hints
    // and errors go. The text they edit becomes their own: the request says `manual`.
    case "edit":
      return {
        ...state,
        input: action.text,
        truncated: false,
        source: "manual",
        error: null,
        unreadable: false,
      };

    case "job":
      return applyJob(state, action.job);

    case "start":
      return { ...state, result: "", streaming: true, error: null, unreadable: false, run: state.run + 1 };

    case "delta":
      return { ...state, result: state.result + action.text };

    case "done":
      return { ...state, streaming: false };

    // Whatever text arrived before the error stays on screen: half a result beats an
    // empty field with an error under it.
    case "error":
      return { ...state, streaming: false, error: { code: action.code, message: action.message } };
  }
}

function applyJob(state: PanelState, job: PanelJob): PanelState {
  // The input field keeps whatever it held: a page that cannot be read is no reason to
  // throw away text the user pasted there.
  if (job.kind === "unreadable") {
    return { ...state, unreadable: true, error: null };
  }

  // A run is writing. Swapping the text under it would leave the result on screen
  // belonging to something else, so the job is dropped: the next click on the icon
  // reads the tab again.
  if (state.streaming) {
    return state;
  }

  return {
    ...state,
    input: job.text,
    truncated: job.truncated,
    source: job.kind === "text" ? job.source : "selection",
    error: null,
    unreadable: false,
  };
}

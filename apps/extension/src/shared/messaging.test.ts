import assert from "node:assert/strict";
import test from "node:test";
import {
  readExtractRequest,
  readPanelMessage,
  readPanelState,
  readSelectionMessage,
} from "./messaging.ts";

// The shapes below are what actually arrived over the port on the day the panel went
// blank. None of them may reach the panel as a job with a missing text, because
// `countCodePoints` spreads that text and `[...undefined]` throws inside render — which
// unmounts the whole panel, not just the message that caused it.

test("a well-formed job passes through", () => {
  assert.deepEqual(
    readPanelMessage({
      type: "job",
      job: { kind: "text", text: "hello", source: "page", truncated: false, pageUrl: "https://x" },
    }),
    { kind: "text", text: "hello", source: "page", truncated: false, pageUrl: "https://x" },
  );
});

test("a text job with no text is an unreadable page, not a crash", () => {
  // The exact shape that blanked the panel.
  const job = readPanelMessage({ type: "job", job: { kind: "text", source: "page" } });
  assert.deepEqual(job, { kind: "unreadable", tabId: undefined });
});

test("a text job whose text is not a string is unreadable too", () => {
  for (const text of [null, 42, {}, [], undefined]) {
    const job = readPanelMessage({ type: "job", job: { kind: "text", text } });
    assert.equal(job?.kind, "unreadable", `text: ${JSON.stringify(text)}`);
  }
});

test("an unreadable job keeps its tab id", () => {
  // The panel disables its read-the-page button while the message is up, and the tab id
  // is what tells it when to stop: lose it here and the button expires on the wrong
  // tab switch.
  assert.deepEqual(readPanelMessage({ type: "job", job: { kind: "unreadable", tabId: 7 } }), {
    kind: "unreadable",
    tabId: 7,
  });
  for (const tabId of [null, "7", {}, undefined]) {
    assert.deepEqual(readPanelMessage({ type: "job", job: { kind: "unreadable", tabId } }), {
      kind: "unreadable",
      tabId: undefined,
    });
  }
});

test("an unknown source falls back rather than travelling on", () => {
  const job = readPanelMessage({ type: "job", job: { kind: "text", text: "hi", source: "elsewhere" } });
  assert.deepEqual(job, { kind: "text", text: "hi", source: "page", truncated: false, pageUrl: undefined });
});

test("truncated is a boolean whatever arrived", () => {
  const job = readPanelMessage({ type: "job", job: { kind: "text", text: "hi", truncated: "yes" } });
  assert.equal(job?.kind === "text" && job.truncated, false);
});

test("anything that is not a job is ignored", () => {
  for (const message of [null, undefined, {}, { type: "state" }, "job", 7, []]) {
    assert.equal(readPanelMessage(message), null, JSON.stringify(message));
  }
});

test("panel state is read, and a broken one is dropped", () => {
  assert.deepEqual(readPanelState({ type: "state", pageUrl: "https://x", hasSummary: true }), {
    type: "state",
    pageUrl: "https://x",
    hasSummary: true,
  });
  assert.deepEqual(readPanelState({ type: "state", pageUrl: 5, hasSummary: "yes" }), {
    type: "state",
    pageUrl: null,
    hasSummary: false,
  });
  assert.equal(readPanelState({ type: "job" }), null);
});

test("an extract request is accepted only for a mode that exists", () => {
  assert.deepEqual(readExtractRequest({ type: "extract", mode: "page" }), { type: "extract", mode: "page" });
  assert.equal(readExtractRequest({ type: "extract", mode: "everything" }), null);
  assert.equal(readExtractRequest({ type: "extract" }), null);
  assert.equal(readExtractRequest(undefined), null);
});

test("a selection message always carries a string", () => {
  assert.deepEqual(readSelectionMessage({ type: "selection-clicked", text: "hi" }), {
    type: "selection-clicked",
    text: "hi",
  });
  assert.deepEqual(readSelectionMessage({ type: "selection-clicked" }), {
    type: "selection-clicked",
    text: "",
  });
  assert.equal(readSelectionMessage({ type: "extract" }), null);
});

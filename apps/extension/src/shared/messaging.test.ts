import assert from "node:assert/strict";
import test from "node:test";
import {
  readExtractRequest,
  readExtractResult,
  readExtractedImages,
  readPanelMessage,
  readPinStateRequest,
  readReadPageReply,
  readReadPageRequest,
  readSelectionChanged,
} from "./messaging.ts";

// The shapes below are what actually arrived over the port on the day the panel went
// blank. None of them may reach the panel as a job with a missing text, because
// `countCodePoints` spreads that text and `[...undefined]` throws inside render — which
// unmounts the whole panel, not just the message that caused it.

const PICTURE = { id: 1, src: "https://example.com/a.jpg", alt: "A photo" };

test("a well-formed text job passes through", () => {
  assert.deepEqual(
    readPanelMessage({
      type: "job",
      job: { kind: "text", text: "hello", source: "selection", truncated: false },
    }),
    { kind: "text", text: "hello", source: "selection", truncated: false, images: [] },
  );
});

test("a text job with no text is an unreadable page, not a crash", () => {
  // The exact shape that blanked the panel.
  assert.deepEqual(readPanelMessage({ type: "job", job: { kind: "text", source: "page" } }), {
    kind: "unreadable",
  });
});

test("a text job whose text is not a string is unreadable too", () => {
  for (const text of [null, 42, {}, [], undefined]) {
    const job = readPanelMessage({ type: "job", job: { kind: "text", text } });
    assert.equal(job?.kind, "unreadable", `text: ${JSON.stringify(text)}`);
  }
});

test("a job that is not an object is unreadable", () => {
  for (const job of [null, undefined, "text", 7]) {
    assert.deepEqual(readPanelMessage({ type: "job", job }), { kind: "unreadable" }, JSON.stringify(job));
  }
});

test("an unknown source falls back to page rather than travelling on", () => {
  assert.deepEqual(readPanelMessage({ type: "job", job: { kind: "text", text: "hi", source: "manual" } }), {
    kind: "text",
    text: "hi",
    source: "page",
    truncated: false,
    images: [],
  });
});

test("truncated is a boolean whatever arrived", () => {
  const job = readPanelMessage({ type: "job", job: { kind: "text", text: "hi", truncated: "yes" } });
  assert.equal(job?.kind === "text" && job.truncated, false);
});

test("a fill job carries the selection and nothing else", () => {
  assert.deepEqual(readPanelMessage({ type: "job", job: { kind: "fill", text: "hi", truncated: true } }), {
    kind: "fill",
    text: "hi",
    truncated: true,
    images: [],
  });
  // The same rule as every other job: a fill with no text is not a fill.
  assert.deepEqual(readPanelMessage({ type: "job", job: { kind: "fill" } }), { kind: "unreadable" });
});

test("anything that is not a job is ignored", () => {
  for (const message of [null, undefined, {}, { type: "state" }, "job", 7, []]) {
    assert.equal(readPanelMessage(message), null, JSON.stringify(message));
  }
});

// The scope is the one thing an extract request carries. A worker from an older build
// sends none, and that is the toolbar click, which is what it always was.
test("an extract request is its type and its scope, defaulting to the toolbar click", () => {
  assert.deepEqual(readExtractRequest({ type: "extract", scope: "page" }), { type: "extract", scope: "page" });
  assert.deepEqual(readExtractRequest({ type: "extract", scope: "auto" }), { type: "extract", scope: "auto" });
  assert.deepEqual(readExtractRequest({ type: "extract" }), { type: "extract", scope: "auto" });
  assert.deepEqual(readExtractRequest({ type: "extract", scope: "selection" }), { type: "extract", scope: "auto" });
  assert.equal(readExtractRequest({ type: "selection-changed" }), null);
  assert.equal(readExtractRequest(undefined), null);
});

test("a read-page request is its type and, when it is a whole number, the panel's window", () => {
  assert.deepEqual(readReadPageRequest({ type: "read-page", windowId: 12 }), { type: "read-page", windowId: 12 });
  assert.deepEqual(readReadPageRequest({ type: "read-page" }), { type: "read-page" });
  for (const windowId of [undefined, null, "12", 1.5, NaN, {}]) {
    assert.deepEqual(readReadPageRequest({ type: "read-page", windowId }), { type: "read-page" }, String(windowId));
  }
  for (const message of [{ type: "extract" }, { type: "selection-changed" }, {}, null, undefined, "read-page"]) {
    assert.equal(readReadPageRequest(message), null, JSON.stringify(message));
  }
});

// The reply to read-page is the one message the panel reads off sendMessage, and a worker
// that died mid-way leaves `undefined` behind. That is a page out of reach, and the hint
// for it says to click the icon — which starts everything over.
test("a read-page reply is read back into shape", () => {
  assert.deepEqual(readReadPageReply({ ok: true, text: "the page", truncated: true, images: [PICTURE] }), {
    ok: true,
    text: "the page",
    truncated: true,
    images: [PICTURE],
  });
  assert.deepEqual(readReadPageReply({ ok: true, text: "the page" }), {
    ok: true,
    text: "the page",
    truncated: false,
    images: [],
  });
  assert.deepEqual(readReadPageReply({ ok: false, reason: "no-text" }), { ok: false, reason: "no-text" });
  assert.deepEqual(readReadPageReply({ ok: false, reason: "no-access" }), { ok: false, reason: "no-access" });
});

test("anything but a well-formed read-page reply is a page out of reach", () => {
  for (const reply of [undefined, null, {}, { ok: false }, { ok: true }, { ok: true, text: 7 }, { ok: false, reason: "x" }, "ok"]) {
    assert.deepEqual(readReadPageReply(reply), { ok: false, reason: "no-access" }, JSON.stringify(reply));
  }
});

test("an extract reply is read back into shape", () => {
  assert.deepEqual(readExtractResult({ ok: true, text: "hi", source: "selection", truncated: false }), {
    ok: true,
    text: "hi",
    source: "selection",
    truncated: false,
    images: [],
  });
  assert.deepEqual(readExtractResult({ ok: true, text: "hi" }), {
    ok: true,
    text: "hi",
    source: "page",
    truncated: false,
    images: [],
  });
});

// sendMessage resolves to undefined when nothing in the tab answered, and an old content
// script left over from a previous build answers in the shape it had then. Both are a
// page that could not be read, not a crash.
test("anything but a well-formed success is a page that could not be read", () => {
  for (const reply of [undefined, null, {}, { ok: false }, { ok: true }, { ok: true, text: 7 }, "ok"]) {
    assert.deepEqual(readExtractResult(reply), { ok: false }, JSON.stringify(reply));
  }
});

test("a selection change with nothing in it is dropped", () => {
  assert.deepEqual(readSelectionChanged({ type: "selection-changed", text: "hi", truncated: false }), {
    type: "selection-changed",
    text: "hi",
    truncated: false,
    images: [],
  });
  assert.equal(readSelectionChanged({ type: "selection-changed", text: "" }), null);
  assert.equal(readSelectionChanged({ type: "selection-changed" }), null);
  assert.equal(readSelectionChanged({ type: "extract" }), null);
  assert.equal(readSelectionChanged(null), null);
});

// The picture table is the newest thing to cross a boundary, and the only one whose
// contents the panel hands to the network: an <img src> is a request. An entry that is
// not exactly what the extractor writes is dropped rather than repaired — the marker
// that pointed at it then renders as nothing, which is what a missing picture looks
// like anyway.
test("a well-formed picture table passes through", () => {
  assert.deepEqual(readExtractedImages([PICTURE]), [PICTURE]);
  assert.deepEqual(readExtractedImages([]), []);
});

test("a table that is not a table at all is an empty one", () => {
  for (const value of [undefined, null, {}, "images", 7, { 0: PICTURE }]) {
    assert.deepEqual(readExtractedImages(value), [], JSON.stringify(value));
  }
});

test("an entry the panel could not use is left behind, the rest are kept", () => {
  const broken = [
    null,
    "https://example.com/a.jpg",
    { id: 1 },
    { id: "1", src: "https://example.com/a.jpg", alt: "" },
    { id: 1.5, src: "https://example.com/a.jpg", alt: "" },
    { id: 2, src: "http://example.com/a.jpg", alt: "" },
    { id: 3, src: "javascript:alert(1)", alt: "" },
    { id: 4, src: "data:image/png;base64,iVBOR", alt: "" },
    { id: 5, src: "/a.jpg", alt: "" },
    { id: 6, src: "https://example.com/a.jpg" },
    { id: 7, src: "https://example.com/a.jpg", alt: 7 },
  ];
  assert.deepEqual(readExtractedImages([...broken, PICTURE]), [PICTURE]);
});

test("the picture table rides along with every message that carries text", () => {
  const job = readPanelMessage({
    type: "job",
    job: { kind: "text", text: "hi", source: "page", truncated: false, images: [PICTURE] },
  });
  assert.deepEqual(job?.kind === "text" && job.images, [PICTURE]);

  const fill = readPanelMessage({ type: "job", job: { kind: "fill", text: "hi", images: [PICTURE] } });
  assert.deepEqual(fill?.kind === "fill" && fill.images, [PICTURE]);

  const reply = readExtractResult({ ok: true, text: "hi", images: [PICTURE] });
  assert.deepEqual(reply.ok && reply.images, [PICTURE]);

  const page = readReadPageReply({ ok: true, text: "hi", images: [PICTURE] });
  assert.deepEqual(page.ok && page.images, [PICTURE]);

  const selection = readSelectionChanged({ type: "selection-changed", text: "hi", images: [PICTURE] });
  assert.deepEqual(selection?.images, [PICTURE]);
});

// The pin question is the one message that arrives from the open web: every page of
// make-it-shorter.net can reach that listener, so the reader has to recognise our own
// question and nothing else.
test("only the pin question is read off the external listener", () => {
  assert.deepEqual(readPinStateRequest({ type: "pin-state" }), { type: "pin-state" });
  for (const message of [{ type: "extract" }, { type: "job" }, {}, null, undefined, "pin-state", 7]) {
    assert.equal(readPinStateRequest(message), null, JSON.stringify(message));
  }
});

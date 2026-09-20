import assert from "node:assert/strict";
import test from "node:test";
import { initialPanelState, panelReducer, type PanelAction, type PanelState } from "./state.ts";

function after(actions: PanelAction[], from: PanelState = initialPanelState): PanelState {
  return actions.reduce(panelReducer, from);
}

const PICTURE = { id: 1, src: "https://example.com/a.jpg", alt: "A photo" };

const pageJob: PanelAction = {
  type: "job",
  job: { kind: "text", text: "the whole page", source: "page", truncated: true, images: [PICTURE] },
};
const fillJob: PanelAction = {
  type: "job",
  job: { kind: "fill", text: "a selection", truncated: false, images: [] },
};

test("a text job fills the field with its source and truncation", () => {
  const state = after([pageJob]);
  assert.equal(state.input, "the whole page");
  assert.equal(state.source, "page");
  assert.equal(state.truncated, true);
});

test("a fill job is a selection", () => {
  const state = after([fillJob]);
  assert.equal(state.input, "a selection");
  assert.equal(state.source, "selection");
});

// The rule the spec calls out: text arriving under a running request is dropped, or the
// result on screen would belong to a text the field no longer shows.
test("text and fill jobs are ignored while streaming", () => {
  const streaming = after([{ type: "edit", text: "typed by hand, long enough" }, { type: "start" }]);
  assert.equal(after([pageJob], streaming), streaming);
  assert.equal(after([fillJob], streaming), streaming);
});

test("the unreadable job leaves the field alone and raises the hint", () => {
  const state = after([{ type: "edit", text: "pasted by hand" }, { type: "job", job: { kind: "unreadable" } }]);
  assert.equal(state.input, "pasted by hand");
  assert.equal(state.unreadable, true);
});

test("typing clears the hint, the error and the truncation, and makes the source manual", () => {
  const before = after([pageJob, { type: "job", job: { kind: "unreadable" } }, { type: "error", code: "too_long" }]);
  const state = after([{ type: "edit", text: "corrected" }], before);
  assert.equal(state.unreadable, false);
  assert.equal(state.error, null);
  assert.equal(state.truncated, false);
  assert.equal(state.source, "manual");
});

test("a run accumulates deltas and finishes on done", () => {
  const state = after([{ type: "start" }, { type: "delta", text: "Shorter " }, { type: "delta", text: "text." }, { type: "done" }]);
  assert.equal(state.result, "Shorter text.");
  assert.equal(state.streaming, false);
  assert.equal(state.error, null);
});

test("a new run clears the previous result and counts itself", () => {
  const first = after([{ type: "start" }, { type: "delta", text: "old" }, { type: "done" }]);
  const second = after([{ type: "start" }], first);
  assert.equal(second.result, "");
  assert.equal(second.streaming, true);
  assert.equal(second.run, first.run + 1);
});

test("an error stops the run and keeps the text received so far", () => {
  const state = after([{ type: "start" }, { type: "delta", text: "half a " }, { type: "error", code: "upstream_error" }]);
  assert.equal(state.streaming, false);
  assert.equal(state.result, "half a ");
  assert.deepEqual(state.error, { code: "upstream_error", message: undefined });
});

test("service_disabled carries the server's message as is", () => {
  const state = after([{ type: "start" }, { type: "error", code: "service_disabled", message: "Back on Monday." }]);
  assert.deepEqual(state.error, { code: "service_disabled", message: "Back on Monday." });
});

test("a job after a finished run replaces the field but not the result", () => {
  const state = after([{ type: "start" }, { type: "delta", text: "result" }, { type: "done" }, fillJob]);
  assert.equal(state.input, "a selection");
  assert.equal(state.result, "result");
});

// The pictures. The field's table is what the next run will refer to; the result's table
// is the one the text on screen refers to, and it is taken when the run starts. Without
// the snapshot, a click on the icon after the run finished would bring in a new table
// and the result already on screen would point into it.

test("a job brings its picture table along with its text", () => {
  assert.deepEqual(after([pageJob]).images, [PICTURE]);
  assert.deepEqual(after([pageJob, fillJob]).images, []);
});

test("a run renders against the table as it stood when it started", () => {
  const running = after([pageJob, { type: "start" }]);
  assert.deepEqual(running.resultImages, [PICTURE]);

  const afterwards = after([{ type: "done" }, fillJob], running);
  assert.deepEqual(afterwards.images, [], "the field follows the new selection");
  assert.deepEqual(afterwards.resultImages, [PICTURE], "the result keeps the table it was written against");
});

test("typing keeps the pictures: fixing a word is no reason to lose them", () => {
  const state = after([pageJob, { type: "edit", text: "the whole page, corrected" }]);
  assert.deepEqual(state.images, [PICTURE]);
});

test("an unreadable page leaves the table alone, like the field", () => {
  const state = after([pageJob, { type: "job", job: { kind: "unreadable" } }]);
  assert.deepEqual(state.images, [PICTURE]);
});

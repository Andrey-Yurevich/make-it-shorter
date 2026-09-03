import assert from "node:assert/strict";
import test from "node:test";
import { initialRunState, runReducer, type RunAction, type RunState } from "./state.ts";

// One rule is worth a test of its own: the message about a page that could not be read
// disables the button that reads the page, so the message has to expire, and it has to
// expire on the right event. Too late and the button is dead on a tab the message was
// never about; too early and the two contradict each other again.

function after(actions: RunAction[], from: RunState = initialRunState): RunState {
  return actions.reduce(runReducer, from);
}

const unreadableTab7 = after([{ type: "unreadable-page", tabId: 7 }]);

test("a page that could not be read is remembered against its tab", () => {
  assert.deepEqual(unreadableTab7.unreadable, { tabId: 7 });
});

test("the message survives while the same tab is in front of the user", () => {
  const state = after([{ type: "tab-activated", tabId: 7 }], unreadableTab7);
  assert.deepEqual(state.unreadable, { tabId: 7 });
  // Nothing changed, so the panel does not re-render either.
  assert.equal(state, unreadableTab7);
});

test("the message goes when the user moves to another tab", () => {
  assert.equal(after([{ type: "tab-activated", tabId: 8 }], unreadableTab7).unreadable, null);
});

test("the message goes when that tab loads something else", () => {
  assert.equal(after([{ type: "tab-navigated", tabId: 7 }], unreadableTab7).unreadable, null);
});

test("another tab loading in the background says nothing about this one", () => {
  const state = after([{ type: "tab-navigated", tabId: 8 }], unreadableTab7);
  assert.deepEqual(state.unreadable, { tabId: 7 });
  assert.equal(state, unreadableTab7);
});

test("without a tab id the message expires on the first switch anywhere", () => {
  const unknownTab = after([{ type: "unreadable-page", tabId: null }]);
  assert.equal(after([{ type: "tab-activated", tabId: 1 }], unknownTab).unreadable, null);
});

test("typing in the field clears the message, whatever the tabs are doing", () => {
  assert.equal(after([{ type: "edit", text: "pasted by hand" }], unreadableTab7).unreadable, null);
});

test("tab events on a panel with no message change nothing at all", () => {
  for (const action of [
    { type: "tab-activated", tabId: 1 },
    { type: "tab-navigated", tabId: 1 },
  ] as RunAction[]) {
    assert.equal(runReducer(initialRunState, action), initialRunState, action.type);
  }
});

test("a page that could not be read keeps the text already in the field", () => {
  const state = after([
    { type: "edit", text: "text the user pasted" },
    { type: "unreadable-page", tabId: 7 },
  ]);
  assert.equal(state.input, "text the user pasted");
});

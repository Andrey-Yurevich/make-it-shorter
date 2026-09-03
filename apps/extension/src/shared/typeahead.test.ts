import assert from "node:assert/strict";
import test from "node:test";
import { TYPEAHEAD_RESET_MS, addKeystroke, matchIndex } from "./typeahead.ts";

// A slice of the real picker, in the order the panel shows it, so the cases below read
// as the thing the user is actually doing.
const LANGUAGES = ["English", "Spanish", "Danish", "Dutch", "German", "Greek"];

test("a letter finds the first option beginning with it", () => {
  assert.equal(matchIndex(LANGUAGES, "d", -1), 2); // Danish
});

test("the same letter again walks to the next of its kind", () => {
  assert.equal(matchIndex(LANGUAGES, "dd", 2), 3); // Danish → Dutch
});

test("walking past the last match wraps round to the first", () => {
  assert.equal(matchIndex(LANGUAGES, "dd", 3), 2); // Dutch → back to Danish
});

test("a letter typed near the bottom reaches a match at the top", () => {
  assert.equal(matchIndex(LANGUAGES, "e", 5), 0); // from Greek round to English
});

test("two different letters are a prefix, not two steps", () => {
  // "du" is Dutch on the second key. Treating it as a second "walk" would have stepped
  // past Dutch to the next d-word instead.
  assert.equal(matchIndex(LANGUAGES, "du", 2), 3);
});

test("a prefix is looked up from the top, wherever the highlight is", () => {
  assert.equal(matchIndex(LANGUAGES, "gr", 4), 5); // Greek, though sitting on German
});

test("matching ignores case", () => {
  assert.equal(matchIndex(LANGUAGES, "SP", 0), 1);
});

test("nothing matching leaves the caller to keep the highlight where it is", () => {
  assert.equal(matchIndex(LANGUAGES, "z", 0), -1);
});

test("an empty list matches nothing rather than dividing by its length", () => {
  assert.equal(matchIndex([], "d", -1), -1);
});

test("every option is reachable, and the list never filters", () => {
  // The guarantee the whole design rests on: a wrong key costs one more key, because
  // everything is still there to be reached.
  for (const [index, label] of LANGUAGES.entries()) {
    assert.equal(matchIndex(LANGUAGES, label.toLowerCase(), -1), index);
  }
});

test("keystrokes close together build one word", () => {
  const first = addKeystroke({ text: "", at: 0 }, "g", 1000);
  const second = addKeystroke(first, "e", 1000 + TYPEAHEAD_RESET_MS - 1);
  assert.equal(second.text, "ge");
});

test("a pause starts the search over", () => {
  const first = addKeystroke({ text: "", at: 0 }, "g", 1000);
  const second = addKeystroke(first, "e", 1000 + TYPEAHEAD_RESET_MS);
  assert.equal(second.text, "e");
});

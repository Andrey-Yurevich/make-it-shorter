import assert from "node:assert/strict";
import test from "node:test";
import { MAX_INPUT } from "./limits.ts";
import { countCodePoints, normalizeText, truncateToCodePoints } from "./text.ts";

test("length is counted in code points, not UTF-16 units", () => {
  assert.equal(countCodePoints("🙂🙂"), 2);
  assert.equal("🙂🙂".length, 4);
});

test("truncation never splits a surrogate pair", () => {
  assert.equal(truncateToCodePoints("a🙂b", 2), "a🙂");
});

test("normalisation collapses spacing and keeps paragraphs", () => {
  const { text } = normalizeText("  Hello\t\tworld \n\n\n\n Second paragraph  ");
  assert.equal(text, "Hello world\n\nSecond paragraph");
});

test("non-breaking spaces collapse like ordinary ones", () => {
  const { text } = normalizeText("a  b");
  assert.equal(text, "a b");
});

test("text over the ceiling is cut and flagged", () => {
  const { text, truncated } = normalizeText("x".repeat(MAX_INPUT + 10));
  assert.equal(countCodePoints(text), MAX_INPUT);
  assert.equal(truncated, true);
});

test("text under the ceiling is not flagged", () => {
  const { truncated } = normalizeText("x".repeat(100));
  assert.equal(truncated, false);
});

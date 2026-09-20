import assert from "node:assert/strict";
import test from "node:test";
import { markdownToPlainText } from "./markdown.ts";

test("paragraphs are separated by one blank line", () => {
  assert.equal(markdownToPlainText("First paragraph.\n\nSecond paragraph.\n"), "First paragraph.\n\nSecond paragraph.");
});

test("emphasis and headings lose their markup", () => {
  assert.equal(markdownToPlainText("## A **bold** heading\n\nSome *emphasis* and __strong__ text."), "A bold heading\n\nSome emphasis and strong text.");
  assert.equal(markdownToPlainText("**Bold line as a heading**\n\nBody."), "Bold line as a heading\n\nBody.");
});

test("list items keep their prefixes, one per line", () => {
  assert.equal(markdownToPlainText("- one\n- two\n- three"), "- one\n- two\n- three");
  assert.equal(markdownToPlainText("1. first\n2. second"), "1. first\n2. second");
  assert.equal(markdownToPlainText("3. third\n4. fourth"), "3. third\n4. fourth");
});

test("a nested list is indented under its item", () => {
  assert.equal(markdownToPlainText("- outer\n  - inner\n- next"), "- outer\n  - inner\n- next");
});

test("table rows are cells joined with a pipe", () => {
  const md = "| Name | Size |\n|---|---|\n| Cat | Small |\n| Horse | Large |";
  assert.equal(markdownToPlainText(md), "Name | Size\nCat | Small\nHorse | Large");
});

// The plain text is what the counter counts and what Copy puts on the clipboard as
// text/plain. A picture is not a character of it: pasting into a chat box should not
// paste the word "chart" where the panel shows a photograph. The text/html half of Copy
// keeps the pictures — it is the rendered DOM.
test("links become their text and images become nothing", () => {
  assert.equal(markdownToPlainText("See [the docs](https://example.com) and ![a chart](x.png)."), "See the docs and .");
  assert.equal(markdownToPlainText("Before.\n\n![](1)\n\nAfter."), "Before.\n\nAfter.");
});

test("code, quotes and rules become plain paragraphs or nothing", () => {
  assert.equal(markdownToPlainText("> quoted words\n\n---\n\n```\ncode here\n```\n\nUse `x`."), "quoted words\n\ncode here\n\nUse x.");
});

test("a hard line break stays a line break inside the paragraph", () => {
  assert.equal(markdownToPlainText("line one  \nline two"), "line one\nline two");
});

test("plain prose passes through unchanged", () => {
  const prose = "Ничего лишнего: одна строка обычного текста с эмодзи 🙂.";
  assert.equal(markdownToPlainText(prose), prose);
});

test("empty input is empty output", () => {
  assert.equal(markdownToPlainText(""), "");
});

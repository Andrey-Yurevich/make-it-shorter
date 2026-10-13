import assert from "node:assert/strict";
import test from "node:test";
import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { remarkFigures } from "./figures.ts";

const parser = unified().use(remarkParse).use(remarkGfm);

// What the renderer is handed: hydrate() has already turned the markers into images.
function blocks(markdown: string): RootContent[] {
  const tree = parser.parse(markdown) as Root;
  remarkFigures()(tree);
  return tree.children;
}

function kinds(markdown: string): string[] {
  return blocks(markdown).map((node) => node.type);
}

test("a picture and the short line under it become one figure", () => {
  const [figure, ...rest] = blocks("![](1)\n\nThe cathedral in 1910.");
  assert.equal(rest.length, 0);
  assert.equal(figure.type, "figure");
  assert.equal(figure.data?.hName, "figure");
  const [picture, caption] = figure.type === "figure" ? figure.children : [];
  assert.equal(picture.children[0].type, "image");
  assert.equal(caption.data?.hName, "figcaption");
  assert.equal(caption.children[0].type === "text" ? caption.children[0].value : "", "The cathedral in 1910.");
});

// The only thing that tells a caption from prose is its length: everything a page marks
// one with is gone by the time the text comes back from the model.
test("a full paragraph after a picture stays a paragraph", () => {
  const prose = "word ".repeat(60);
  assert.deepEqual(kinds(`![](1)\n\n${prose}`), ["paragraph", "paragraph"]);
});

test("a picture with nothing under it is left alone", () => {
  assert.deepEqual(kinds("![](1)"), ["paragraph"]);
  assert.deepEqual(kinds("![](1)\n\n![](2)"), ["paragraph", "paragraph"]);
  assert.deepEqual(kinds("![](1)\n\n- An item\n- Another"), ["paragraph", "list"]);
});

// Text, then a picture, then its caption: only the picture pulls the line after it in.
test("the paragraph before a picture is not touched", () => {
  assert.deepEqual(kinds("Before.\n\n![](1)\n\nA caption.\n\nAfter."), ["paragraph", "figure", "paragraph"]);
});

test("a picture inside a paragraph of text is not a figure", () => {
  assert.deepEqual(kinds("Text with ![](1) in it.\n\nA short line."), ["paragraph", "paragraph"]);
});

// The length is read through the markup: a caption the model set in bold or italics is
// still a caption, and a long one dressed up is still too long.
test("markup around the caption is read through", () => {
  assert.deepEqual(kinds("![](1)\n\n*Photo: Reuters*"), ["figure"]);
  assert.deepEqual(kinds(`![](1)\n\n**${"word ".repeat(60)}**`), ["paragraph", "paragraph"]);
});

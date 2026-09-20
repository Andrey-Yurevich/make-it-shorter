import assert from "node:assert/strict";
import test from "node:test";
import { hydrate } from "./hydrate.ts";
import type { ExtractedImage } from "./messaging.ts";

const IMAGES: ExtractedImage[] = [
  { id: 1, src: "https://example.com/a.jpg", alt: "A photo" },
  { id: 2, src: "https://example.com/b.jpg", alt: "" },
];

test("a marker becomes an image carrying the number, never the address", () => {
  assert.equal(hydrate("Before.\n\n{{img:1}}\n\nAfter.", IMAGES, false), "Before.\n\n![](1)\n\nAfter.");
  assert.ok(!hydrate("{{img:1}}", IMAGES, false).includes("example.com"));
});

// What the model does to a marker now and then, and what it is forgiven. The two
// opening braces are the one thing that has to be there: the page's own "{{" is escaped
// apart by the extractor, and forgiving a single brace would undo that.
test("spacing, case and a lost closing brace are forgiven", () => {
  for (const written of ["{{img:2}}", "{{ img : 2 }}", "{{IMG:2}}", "{{img:2}", "{{img:2"]) {
    assert.equal(hydrate(written, IMAGES, false), "![](2)", written);
  }
  assert.equal(hydrate("{ {img:2}}", IMAGES, false), "{ {img:2}}");
  assert.equal(hydrate("{img:2}", IMAGES, false), "{img:2}");
});

test("a number with no picture behind it leaves nothing", () => {
  assert.equal(hydrate("Text {{img:9}} here", IMAGES, false), "Text  here");
  assert.equal(hydrate("{{img:1}}", [], false), "");
});

// The same picture twice is the model repeating itself, which it is told not to do with
// anything else either.
test("a picture claimed twice is shown once", () => {
  assert.equal(hydrate("{{img:1}} and {{img:1}}", IMAGES, false), "![](1) and ");
});

test("half a marker at the end of a stream is not shown", () => {
  for (const tail of ["{", "{{", "{{i", "{{img", "{{img:", "{{img:1", "{{ img : 1"]) {
    assert.equal(hydrate(`Text ${tail}`, IMAGES, true), "Text ", tail);
  }
  // Complete: rendered straight away, without waiting for the run to finish.
  assert.equal(hydrate("Text {{img:1}}", IMAGES, true), "Text ![](1)");
  // Only at the end. A marker in the middle of the text is finished by definition.
  assert.equal(hydrate("{{img:1}} then {{img:2}}", IMAGES, true), "![](1) then ![](2)");
  // And once the run is over there is nothing more coming: whatever the stream ended
  // with is read as best it can be.
  assert.equal(hydrate("Text {{img:1", IMAGES, false), "Text ![](1)");
});

// hydrate resolves markers and nothing else. An address the model produced by itself
// stays an ordinary Markdown image here — it is MarkdownView that refuses to fetch it,
// because it looks its pictures up by number and this is not one.
test("an image the model wrote by itself is left for the renderer to refuse", () => {
  const written = "![a chart](https://somewhere.example/x.png)";
  assert.equal(hydrate(written, IMAGES, false), written);
});

test("text with no markers passes through untouched", () => {
  const prose = "Ничего лишнего: одна строка обычного текста {с фигурными скобками}.";
  assert.equal(hydrate(prose, IMAGES, false), prose);
  assert.equal(hydrate(prose, IMAGES, true), prose);
  assert.equal(hydrate("", IMAGES, true), "");
});

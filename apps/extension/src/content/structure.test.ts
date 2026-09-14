import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { normalizeText } from "../shared/text.ts";
import { textWithStructure } from "./structure.ts";

// The tests read the result the way the panel and the model will: after normalizeText,
// which is what folds the loose blank lines the renderer leaves behind.
function structured(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return normalizeText(textWithStructure(document.body as unknown as Node)).text;
}

test("prose stays prose, paragraphs stay apart", () => {
  assert.equal(
    structured("<p>First <b>bold</b> and <a href='#'>a link</a>.</p><p>Second.</p>"),
    "First bold and a link.\n\nSecond.",
  );
});

test("list items get markers, ordered lists count from start", () => {
  assert.equal(structured("<ul><li>one</li><li>two</li></ul>"), "- one\n- two");
  assert.equal(structured("<ol start='3'><li>c</li><li>d</li></ol>"), "3. c\n4. d");
});

test("a nested list is flattened into further items", () => {
  assert.equal(
    structured("<ul><li>parent<ul><li>child</li></ul></li><li>next</li></ul>"),
    "- parent\n- child\n- next",
  );
});

test("an item without its list — a partial selection — still gets a marker", () => {
  assert.equal(structured("<li>alone</li><li>too</li>"), "- alone\n- too");
});

test("headings become bold lines", () => {
  assert.equal(structured("<h2>Military</h2><p>Text.</p>"), "**Military**\n\nText.");
});

test("a table becomes rows of cells with a separator after the first", () => {
  assert.equal(
    structured("<table><thead><tr><th>Name</th><th>Born</th></tr></thead><tbody><tr><td>Augustus</td><td>63 BC</td></tr></tbody></table>"),
    "| Name | Born |\n| --- | --- |\n| Augustus | 63 BC |",
  );
});

test("a cell folds onto its line and escapes the bar", () => {
  assert.equal(
    structured("<table><tr><td>a<br>b</td><td>x | y</td></tr></table>"),
    "| a b | x \\| y |\n| --- | --- |",
  );
});

test("a partial selection of rows — no table around them — still gives rows", () => {
  assert.equal(structured("<tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr>"), "| a | b |\n| c | d |");
});

test("a row of empty cells is nothing", () => {
  assert.equal(structured("<table><tr><td></td><td> </td></tr><tr><td>x</td><td>y</td></tr></table>"), "| x | y |\n| --- | --- |");
});

test("a table inside a cell is flat text of that cell", () => {
  assert.equal(
    structured("<table><tr><td>outer</td><td><table><tr><td>in</td><td>ner</td></tr></table></td></tr></table>"),
    "| outer | in ner |\n| --- | --- |",
  );
});

test("footnote markers and edit chrome are dropped", () => {
  assert.equal(
    structured("<p>Peace.<sup class='reference'><a href='#'>[209]</a></sup> Then<sup>[a]</sup> war.<sup>2</sup></p>"),
    "Peace. Then war.2",
  );
});

test("scripts, styles, hidden and media are not text", () => {
  assert.equal(
    structured("<p>Seen</p><script>x()</script><style>p{}</style><p hidden>no</p><p aria-hidden='true'>no</p><img alt='no'>"),
    "Seen",
  );
});

test("line breaks inside a paragraph stay single lines", () => {
  assert.equal(structured("<p>Roses are red<br>violets are blue</p>"), "Roses are red\nviolets are blue");
});

test("a text node alone renders as itself", () => {
  assert.equal(structured("just   words\n here"), "just words here");
});

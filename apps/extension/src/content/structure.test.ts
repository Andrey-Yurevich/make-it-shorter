import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { normalizeText } from "../shared/text.ts";
import { selectionWithStructure, textWithStructure, type Structured } from "./structure.ts";

const PAGE = "https://example.com/news/article";

// The tests read the result the way the panel and the model will: after normalizeText,
// which is what folds the loose blank lines the renderer leaves behind. The page has a
// <base>, because half of what the walker does with a picture is work out its address.
function walk(html: string): Structured {
  const { document } = parseHTML(
    `<!doctype html><html><head><base href="${PAGE}"></head><body>${html}</body></html>`,
  );
  const result = textWithStructure(document.body as unknown as Node);
  return { text: normalizeText(result.text).text, images: result.images };
}

function structured(html: string): string {
  return walk(html).text;
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

test("a table whose rows differ in width — an infobox — becomes label: value lines", () => {
  assert.equal(
    structured(
      "<table class='infobox'><tr><th colspan='2'>Roman Empire<div>Imperium Romanum</div></th></tr>" +
        "<tr><td colspan='2'><img alt='map'></td></tr>" +
        "<tr><th>Capital</th><td>Rome</td></tr><tr><th>Languages</th><td>Latin</td><td>Greek</td></tr></table>",
    ),
    "Roman Empire Imperium Romanum\nCapital: Rome\nLanguages: Latin, Greek",
  );
});

test("a one-column table is lines, not a table", () => {
  assert.equal(structured("<table><tr><td>a</td></tr><tr><td>b</td></tr></table>"), "a\nb");
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
    structured("<p>Seen</p><script>x()</script><style>p{}</style><p hidden>no</p><p aria-hidden='true'>no</p><video src='v.mp4'></video>"),
    "Seen",
  );
});

test("line breaks inside a paragraph stay single lines", () => {
  assert.equal(structured("<p>Roses are red<br>violets are blue</p>"), "Roses are red\nviolets are blue");
});

test("a text node alone renders as itself", () => {
  assert.equal(structured("just   words\n here"), "just words here");
});

// Pictures. The text carries a number, the table carries the address, and the two are
// only put back together in the panel — nothing about a picture is ever sent anywhere.

test("a picture between paragraphs becomes a marker and a table entry", () => {
  const { text, images } = walk("<p>Before.</p><img src='/photo.jpg' alt='A photo'><p>After.</p>");
  assert.equal(text, "Before.\n\n{{img:1}}\n\nAfter.");
  assert.deepEqual(images, [{ id: 1, src: "https://example.com/photo.jpg", alt: "A photo" }]);
});

test("a relative address resolves against the page", () => {
  assert.deepEqual(walk("<img src='photo.jpg'>").images, [
    { id: 1, src: "https://example.com/news/photo.jpg", alt: "" },
  ]);
});

test("a lazy picture is found behind data-src, data-lazy-src and srcset", () => {
  const placeholder = "data:image/gif;base64,R0lGOD";
  assert.deepEqual(walk(`<img src="${placeholder}" data-src="/real.jpg" alt="">`).images, [
    { id: 1, src: "https://example.com/real.jpg", alt: "" },
  ]);
  assert.deepEqual(walk(`<img src="${placeholder}" srcset="/small.jpg 480w, /large.jpg 1200w">`).images, [
    { id: 1, src: "https://example.com/small.jpg", alt: "" },
  ]);
  assert.deepEqual(walk(`<img data-lazy-src="/lazy.jpg">`).images, [
    { id: 1, src: "https://example.com/lazy.jpg", alt: "" },
  ]);
});

test("an address we could not fetch leaves nothing at all — no marker, no entry", () => {
  for (const attributes of ['src="data:image/png;base64,iVBOR"', 'src="blob:https://example.com/x"', 'alt="none"']) {
    const { text, images } = walk(`<p>A</p><img ${attributes}><p>B</p>`);
    assert.equal(text, "A\n\nB", attributes);
    assert.deepEqual(images, [], attributes);
  }
});

test("http is raised to https: the panel would block it as mixed content", () => {
  assert.deepEqual(walk("<img src='http://cdn.example.org/a.png'>").images, [
    { id: 1, src: "https://cdn.example.org/a.png", alt: "" },
  ]);
});

test("a picture that declares itself tiny is furniture", () => {
  assert.deepEqual(walk("<img src='/pixel.gif' width='1' height='1'>").images, []);
  assert.deepEqual(walk("<img src='/icon.png' height='16'>").images, []);
  // Declaring no size is not declaring a small one: a detached document has no layout,
  // so most pictures arrive without either attribute and have to be kept.
  assert.equal(walk("<img src='/photo.jpg'>").images.length, 1);
  assert.equal(walk("<img src='/photo.jpg' width='800' height='600'>").images.length, 1);
});

test("picture renders the img it wraps and ignores the sources", () => {
  const { text, images } = walk(
    "<picture><source srcset='/a.webp' type='image/webp'><img src='/a.jpg' alt='A'></picture>",
  );
  assert.equal(text, "{{img:1}}");
  assert.deepEqual(images, [{ id: 1, src: "https://example.com/a.jpg", alt: "A" }]);
});

test("a caption is the paragraph after the marker, for the model to shorten or drop", () => {
  assert.equal(
    structured("<figure><img src='/chart.png' alt='Chart'><figcaption>Growth since 1990.</figcaption></figure>"),
    "{{img:1}}\n\nGrowth since 1990.",
  );
});

test("inside a list item and a table cell the marker stays in the line", () => {
  assert.equal(
    structured("<ul><li>First <img src='/a.png'> item</li><li>Second</li></ul>"),
    "- First {{img:1}} item\n- Second",
  );
  assert.equal(
    structured("<table><tr><td>Flag</td><td><img src='/f.png'></td></tr><tr><td>Name</td><td>Rome</td></tr></table>"),
    "| Flag | {{img:1}} |\n| --- | --- |\n| Name | Rome |",
  );
});

test("past the limit the rest of the pictures are dropped silently", () => {
  const gallery = Array.from({ length: 25 }, (_, index) => `<img src="/p${index}.jpg">`).join("");
  const { text, images } = walk(gallery);
  assert.equal(images.length, 20);
  assert.equal(images.at(-1)?.id, 20);
  assert.ok(text.includes("{{img:20}}"));
  assert.ok(!text.includes("{{img:21}}"));
});

// A page that writes the marker itself must not be able to put one of its own pictures
// into the result. The opening braces come apart, and the panel's reader wants them
// together.
test("a marker written by the page is escaped out of the way", () => {
  assert.equal(structured("<p>Type {{img:1}} to insert.</p>"), "Type { {img:1}} to insert.");
  assert.equal(structured("<pre>{{ IMG : 2 }}</pre>"), "{ { IMG : 2 }}");
  // Braces that are not a marker are left exactly as the page wrote them.
  assert.equal(structured("<p>{{count}} items</p>"), "{{count}} items");
});

// cloneContents() hands back the selected nodes without the ancestors that were only
// partly selected: a selection that starts inside a <figure> arrives as a bare <img> and
// a bare <figcaption>, and renders as a marker and a paragraph all the same. The
// numbering runs straight through every range of one selection.
test("a selection of several ranges numbers its pictures straight through", () => {
  const { document } = parseHTML(
    `<!doctype html><html><head><base href="${PAGE}"></head><body>` +
      `<figure id="one"><img src="https://cdn.example.org/a.jpg" alt="A"><figcaption>First</figcaption></figure>` +
      `<p id="two">Text <img src="https://cdn.example.org/b.jpg" alt="B"> more</p>` +
      `</body></html>`,
  );
  const ranges = ["#one", "#two"].map((selector) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(selector) as unknown as Node);
    return range;
  });
  const selection = { rangeCount: ranges.length, getRangeAt: (index: number) => ranges[index] };

  const result = selectionWithStructure(selection as unknown as Selection);
  assert.equal(normalizeText(result.text).text, "{{img:1}}\n\nFirst\n\nText\n\n{{img:2}}\n\nmore");
  assert.deepEqual(result.images, [
    { id: 1, src: "https://cdn.example.org/a.jpg", alt: "A" },
    { id: 2, src: "https://cdn.example.org/b.jpg", alt: "B" },
  ]);
});

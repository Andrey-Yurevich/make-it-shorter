import type { ExtractedImage } from "../shared/messaging.ts";

// Turns a DOM subtree into plain text that still shows its shape: headings as bold
// lines, list items with "- " or "1. ", tables as rows of "| cell |", and "{{img:N}}"
// where a picture stood. Nothing else — no links, no emphasis. This is the little
// Markdown the prompt tells the model to recognise and mirror, and it is written here,
// on the DOM, because it cannot be recovered later: textContent and Selection.toString()
// drop list markers and table borders, and a table of cells one per line is
// indistinguishable from a list.
//
// One walk over the nodes, a switch on the tag name, string concatenation. The result
// is deliberately loose about blank lines — normalizeText folds them afterwards.

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

// Not content: nothing a reader would read as part of the text. <source> is here for
// <picture>, which is otherwise walked through to the <img> it wraps.
const SKIPPED_TAGS = new Set([
  "script", "style", "noscript", "template", "iframe", "object", "embed",
  "svg", "math", "canvas", "video", "audio", "source",
  "input", "select", "textarea", "button",
]);

// Elements that start on their own line and leave a blank line around themselves.
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "nav",
  "blockquote", "pre", "figure", "figcaption", "address", "details", "summary",
  "form", "fieldset", "dl", "dt", "dd", "hr", "caption",
]);

// Footnote markers: "[12]", "[a]", "[note 3]". Wikipedia marks them with a class as
// well, but the shape of the text is the general rule.
const FOOTNOTE_MARKER = /^\s*\[[^\]]{1,10}\]\s*$/;

// How many pictures one extraction carries. Past this the rest are dropped without a
// marker: a gallery would otherwise spend the input limit on markers and hand the reader
// a wall of thumbnails.
const MAX_IMAGES = 20;

// A picture that declares itself smaller than this is furniture: a tracking pixel, a
// bullet, a share icon. Only the attributes are read — a detached document has no
// layout — so a picture that declares no size at all is kept.
const MIN_IMAGE_SIDE = 40;

// URL attributes in the order they are trusted: src, then what the lazy-loaders leave
// behind. On the page path Readability has already run _fixLazyImages and
// _fixRelativeUris; on the selection path this list is all there is.
const IMAGE_URL_ATTRIBUTES = ["src", "data-src", "data-lazy-src"];
const IMAGE_SRCSET_ATTRIBUTES = ["srcset", "data-srcset"];

// What stands in the text where the page had a picture. The number indexes the table
// that travels beside the text, and only the table holds the URL: the marker is all the
// server and the model ever see, so no address of anything the user looked at leaves the
// device. It is also about five tokens, where a URL is dozens the model would garble.
//
// Two braces, not the sentinel's two brackets: the server holds the head of the stream
// back while it could still be "[[NOTHING_TO_SHORTEN]]", and a marker that looked like
// the start of it would be held back too. The shape is shared data, like the error
// codes — the prompt in apps/backend/prompt.go keeps its own copy, each side tested
// against its own.
export function imageMarker(id: number): string {
  return `{{img:${id}}}`;
}

// A page that writes "{{img:1}}" in its own text must not be able to put a picture in
// the result, so the opening braces are split apart. The panel's reader wants both of
// them together and finds one brace, a space and another.
function escapeMarkers(text: string): string {
  return text.replace(/\{\{(?=\s*img\s*:)/gi, "{ {");
}

export type Structured = {
  text: string;
  // In document order, numbered from one. The text refers to them by number and never
  // by address.
  images: ExtractedImage[];
};

export function textWithStructure(root: Node): Structured {
  const images: ExtractedImage[] = [];
  return { text: render(root, images, "block"), images };
}

// Each range of the selection on its own, blank line between them, the pictures numbered
// straight through all of them. cloneContents keeps the partially selected ancestors, so
// a selection that starts inside one list item and ends inside another comes back as
// bare <li> elements — render handles an item without its list, and a row without its
// table, for exactly this reason.
export function selectionWithStructure(selection: Selection): Structured {
  const images: ExtractedImage[] = [];
  const parts: string[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    parts.push(render(selection.getRangeAt(i).cloneContents(), images, "block"));
  }
  return { text: parts.join("\n\n"), images };
}

// Where in the text the walk currently is. "cell" is the inside of a table cell:
// everything there has to fit on the row's one line, so a nested table gives up its rows
// and is the cell's text, flat. "item" is the inside of a list item, which is one line
// too — a picture there stands in the line rather than breaking it in half.
type Flow = "block" | "item" | "cell";

function render(node: Node, images: ExtractedImage[], flow: Flow): string {
  if (node.nodeType === TEXT_NODE) {
    return escapeMarkers((node.nodeValue ?? "").replace(/\s+/g, " "));
  }
  if (node.nodeType !== ELEMENT_NODE) {
    return renderChildren(node, images, flow);
  }

  const element = node as Element;
  const tag = element.localName;

  if (SKIPPED_TAGS.has(tag) || element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
    return "";
  }
  if (tag === "sup" && (element.classList.contains("reference") || FOOTNOTE_MARKER.test(element.textContent ?? ""))) {
    return "";
  }

  if (tag === "br") {
    return "\n";
  }
  if (tag === "img") {
    return renderImage(element, images, flow);
  }
  if (/^h[1-6]$/.test(tag)) {
    const heading = renderChildren(element, images, flow).replace(/\s+/g, " ").trim();
    return heading === "" ? "" : `\n\n**${heading}**\n\n`;
  }
  if (tag === "li") {
    const inside = flow === "cell" ? "cell" : "item";
    return `\n${listMarker(element)}${renderChildren(element, images, inside).trim()}`;
  }
  if (tag === "ul" || tag === "ol") {
    // A list nested in an item continues the item's list; a list of its own stands apart.
    const nested = element.parentElement?.localName === "li";
    return nested ? renderChildren(element, images, flow) : `\n\n${renderChildren(element, images, flow)}\n\n`;
  }
  if (tag === "table") {
    return flow === "cell" ? renderChildren(element, images, flow) : renderTable(element, images);
  }
  if (tag === "tr") {
    return flow === "cell" ? renderChildren(element, images, flow) : `\n${formatRow(rowCells(element, images))}`;
  }
  if (tag === "pre") {
    return `\n\n${escapeMarkers(element.textContent ?? "")}\n\n`;
  }
  if (BLOCK_TAGS.has(tag) || tag === "td" || tag === "th") {
    return `\n\n${renderChildren(element, images, flow)}\n\n`;
  }
  return renderChildren(element, images, flow);
}

function renderChildren(node: Node, images: ExtractedImage[], flow: Flow): string {
  let out = "";
  for (const child of node.childNodes) {
    out += render(child, images, flow);
  }
  return out;
}

// A picture becomes a number in the text and an entry in the table beside it. Everything
// that is not worth a number — too small, no address we can fetch, one too many — leaves
// nothing at all: a marker with no picture behind it is worse than no marker.
function renderImage(image: Element, images: ExtractedImage[], flow: Flow): string {
  if (images.length >= MAX_IMAGES || tooSmall(image)) {
    return "";
  }
  const src = imageSrc(image);
  if (src === null) {
    return "";
  }

  const id = images.length + 1;
  images.push({ id, src, alt: (image.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim() });
  const marker = imageMarker(id);
  // A block of its own everywhere but inside a line that cannot be broken. A <figcaption>
  // is a block already, so the caption lands in the paragraph after the marker and the
  // model may shorten or drop it like any other paragraph.
  return flow === "block" ? `\n\n${marker}\n\n` : ` ${marker} `;
}

// https only. http is raised to it — the panel is an extension page and the browser
// would block the mixed content — and everything else is refused: a data: URL is bigger
// than the picture is worth, and a blob: URL belongs to the page's origin and would not
// load from here. The first candidate that survives wins, which is also how a lazy-load
// placeholder in src loses to the real address in data-src.
function imageSrc(image: Element): string | null {
  // `undefined`, never `null`: URL() reads a null base as the string "null" and throws
  // on it, which would lose absolute addresses along with the relative ones.
  const base = image.ownerDocument?.baseURI ?? undefined;
  for (const candidate of imageCandidates(image)) {
    let url: URL;
    try {
      // A relative address resolves against the document the element belongs to. A clone
      // keeps its ownerDocument, so the selection path resolves against the live page,
      // and the detached document Readability's HTML is parsed into carries the page's
      // URL as well.
      url = new URL(candidate, base);
    } catch {
      continue;
    }
    if (url.protocol === "http:") {
      url.protocol = "https:";
    }
    if (url.protocol === "https:") {
      return url.href;
    }
  }
  return null;
}

function imageCandidates(image: Element): string[] {
  const candidates: string[] = [];
  for (const name of IMAGE_URL_ATTRIBUTES) {
    const value = (image.getAttribute(name) ?? "").trim();
    if (value !== "") {
      candidates.push(value);
    }
  }
  for (const name of IMAGE_SRCSET_ATTRIBUTES) {
    const first = firstSrcsetCandidate(image.getAttribute(name) ?? "");
    if (first !== "") {
      candidates.push(first);
    }
  }
  return candidates;
}

// "small.png 1x, large.png 2x" — the first one, whatever its descriptor says. Choosing
// the candidate that fits the panel would need the panel's width here, and the panel
// scales whatever it gets anyway.
function firstSrcsetCandidate(value: string): string {
  return value.split(",")[0].trim().split(/\s+/)[0] ?? "";
}

function tooSmall(image: Element): boolean {
  for (const name of ["width", "height"]) {
    const declared = Number.parseInt(image.getAttribute(name) ?? "", 10);
    if (Number.isFinite(declared) && declared < MIN_IMAGE_SIDE) {
      return true;
    }
  }
  return false;
}

// "1. " counted among the item's siblings when the list is ordered, "- " otherwise —
// including for an item that lost its list to a partial selection. Nested lists are
// flattened: their items come out as further top-level items. The indentation that
// would nest them does not survive normalizeText, and the model does not need it.
function listMarker(item: Element): string {
  const list = item.parentElement;
  if (list?.localName !== "ol") {
    return "- ";
  }
  let index = Number(list.getAttribute("start") ?? "1");
  for (const sibling of list.children) {
    if (sibling === item) {
      break;
    }
    if (sibling.localName === "li") {
      index++;
    }
  }
  return `${index}. `;
}

// Rows of this table only, not of tables nested in its cells.
//
// A table of data — every row the same number of cells, two or more — is drawn as a
// Markdown table; the separator after the first row is what makes it one to a Markdown
// reader, and to the model. Anything else is not data but layout: an infobox with a
// title spanning the top and "label | value" rows under it, a card, a form. Drawn as a
// table it came out as one lopsided column; drawn as "label: value" lines it reads.
function renderTable(table: Element, images: ExtractedImage[]): string {
  const rows: string[][] = [];
  for (const row of table.querySelectorAll("tr")) {
    if (row.closest("table") !== table) {
      continue;
    }
    const cells = rowCells(row, images);
    if (cells.some((cell) => cell !== "")) {
      rows.push(cells);
    }
  }
  if (rows.length === 0) {
    return "";
  }

  const columns = rows[0].length;
  const isData = columns >= 2 && rows.every((cells) => cells.length === columns);
  if (isData) {
    const lines = [formatRow(rows[0]), formatRow(rows[0].map(() => "---")), ...rows.slice(1).map(formatRow)];
    return `\n\n${lines.join("\n")}\n\n`;
  }

  const lines = rows.map((cells) => {
    const [first, ...rest] = cells.filter((cell) => cell !== "");
    return rest.length === 0 ? first : `${first}: ${rest.join(", ")}`;
  });
  return `\n\n${lines.join("\n")}\n\n`;
}

// A cell's text folded onto one line, the bar escaped so it cannot pass for a border.
function rowCells(row: Element, images: ExtractedImage[]): string[] {
  const cells: string[] = [];
  for (const cell of row.children) {
    if (cell.localName === "td" || cell.localName === "th") {
      cells.push(renderChildren(cell, images, "cell").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim());
    }
  }
  return cells;
}

function formatRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

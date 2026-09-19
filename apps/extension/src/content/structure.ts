// Turns a DOM subtree into plain text that still shows its shape: headings as bold
// lines, list items with "- " or "1. ", tables as rows of "| cell |". Nothing else — no
// links, no emphasis, no images. This is the little Markdown the prompt tells the model
// to recognise and mirror, and it is written here, on the DOM, because it cannot be
// recovered later: textContent and Selection.toString() drop list markers and table
// borders, and a table of cells one per line is indistinguishable from a list.
//
// One walk over the nodes, a switch on the tag name, string concatenation. The result
// is deliberately loose about blank lines — normalizeText folds them afterwards.

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

// Not content: nothing a reader would read as part of the text.
const SKIPPED_TAGS = new Set([
  "script", "style", "noscript", "template", "iframe", "object", "embed",
  "svg", "math", "canvas", "video", "audio", "img", "picture",
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

export function textWithStructure(root: Node): string {
  return render(root, false);
}

// Each range of the selection on its own, blank line between them. cloneContents keeps
// the partially selected ancestors, so a selection that starts inside one list item
// and ends inside another comes back as bare <li> elements — render handles an item
// without its list, and a row without its table, for exactly this reason.
export function selectionWithStructure(selection: Selection): string {
  const parts: string[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    parts.push(render(selection.getRangeAt(i).cloneContents(), false));
  }
  return parts.join("\n\n");
}

// inCell is true while rendering the inside of a table cell: everything there has to
// fit on the row's one line, so a nested table gives up its rows and is the cell's
// text, flat.
function render(node: Node, inCell: boolean): string {
  if (node.nodeType === TEXT_NODE) {
    return (node.nodeValue ?? "").replace(/\s+/g, " ");
  }
  if (node.nodeType !== ELEMENT_NODE) {
    return renderChildren(node, inCell);
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
  if (/^h[1-6]$/.test(tag)) {
    const heading = renderChildren(element, inCell).replace(/\s+/g, " ").trim();
    return heading === "" ? "" : `\n\n**${heading}**\n\n`;
  }
  if (tag === "li") {
    return `\n${listMarker(element)}${renderChildren(element, inCell).trim()}`;
  }
  if (tag === "ul" || tag === "ol") {
    // A list nested in an item continues the item's list; a list of its own stands apart.
    const nested = element.parentElement?.localName === "li";
    return nested ? renderChildren(element, inCell) : `\n\n${renderChildren(element, inCell)}\n\n`;
  }
  if (tag === "table") {
    return inCell ? renderChildren(element, inCell) : renderTable(element);
  }
  if (tag === "tr") {
    return inCell ? renderChildren(element, inCell) : `\n${formatRow(rowCells(element))}`;
  }
  if (tag === "pre") {
    return `\n\n${element.textContent ?? ""}\n\n`;
  }
  if (BLOCK_TAGS.has(tag) || tag === "td" || tag === "th") {
    return `\n\n${renderChildren(element, inCell)}\n\n`;
  }
  return renderChildren(element, inCell);
}

function renderChildren(node: Node, inCell: boolean): string {
  let out = "";
  for (const child of node.childNodes) {
    out += render(child, inCell);
  }
  return out;
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
function renderTable(table: Element): string {
  const rows: string[][] = [];
  for (const row of table.querySelectorAll("tr")) {
    if (row.closest("table") !== table) {
      continue;
    }
    const cells = rowCells(row);
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
function rowCells(row: Element): string[] {
  const cells: string[] = [];
  for (const cell of row.children) {
    if (cell.localName === "td" || cell.localName === "th") {
      cells.push(renderChildren(cell, true).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim());
    }
  }
  return cells;
}

function formatRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

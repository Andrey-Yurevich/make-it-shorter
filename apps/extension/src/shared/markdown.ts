import type { ListItem, PhrasingContent, Root, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// The plain-text reading of the result, for the character counter and for the text/plain
// half of Copy. It walks the same syntax tree react-markdown renders from — remark with
// GFM tables — so the two agree on what is a paragraph and what is a list item.
//
//   paragraphs and headings   separated by a blank line, markup stripped
//   list items                one per line, "- " or "1. " in front
//   table rows                cells joined with " | "
//   links                     their text; images their alt text
//   code, quotes              their text as an ordinary paragraph

const parser = unified().use(remarkParse).use(remarkGfm);

export function markdownToPlainText(markdown: string): string {
  const tree = parser.parse(markdown) as Root;
  return blocks(tree.children).join("\n\n");
}

function blocks(nodes: RootContent[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    const text = block(node);
    if (text !== "") {
      out.push(text);
    }
  }
  return out;
}

function block(node: RootContent): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return inline(node.children);
    case "list": {
      let number = node.start ?? 1;
      return node.children
        .map((item) => {
          const prefix = node.ordered ? `${number++}. ` : "- ";
          return prefix + listItem(item, prefix.length);
        })
        .join("\n");
    }
    case "table":
      return table(node);
    case "blockquote":
      return blocks(node.children).join("\n\n");
    case "code":
    case "html":
      return node.value;
    case "text":
      return node.value;
    default:
      // Thematic breaks, definitions, footnote definitions: nothing a reader would
      // count or paste.
      return "";
  }
}

// A list item may hold several blocks — a paragraph and a nested list, most often. The
// first line takes the prefix; every other line is indented under it.
function listItem(item: ListItem, indent: number): string {
  const lines = blocks(item.children).join("\n").split("\n");
  return lines.map((line, index) => (index === 0 ? line : " ".repeat(indent) + line)).join("\n");
}

function table(node: Table): string {
  return node.children.map((row) => row.children.map((cell) => inline(cell.children)).join(" | ")).join("\n");
}

function inline(nodes: PhrasingContent[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "inlineCode":
      case "html":
        out += node.value;
        break;
      case "break":
        out += "\n";
        break;
      case "image":
        out += node.alt ?? "";
        break;
      case "emphasis":
      case "strong":
      case "delete":
      case "link":
      case "linkReference":
        out += inline(node.children);
        break;
      default:
        // Footnote references, image references: nothing to read.
        break;
    }
  }
  return out;
}

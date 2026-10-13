import type { Nodes, Paragraph, Root, RootContent } from "mdast";
import { countCodePoints } from "./text.ts";

// A picture and the line under it are one thing, and nothing in the text says so.
//
// The extraction writes a <figcaption> as the block after the marker (content/
// structure.ts), the model shortens it like any other paragraph, and what comes back is
// a picture followed by a sentence. Rendered as two blocks it reads as the next sentence
// of the text rather than as the caption of the picture above it, which is what it is.
//
// So: a paragraph holding nothing but a picture, followed by a short paragraph, becomes
// one <figure> with the second as its <figcaption>. Being short is the whole test — the
// caption lost every mark of one on the way through the model, and a long paragraph
// after a picture is prose that happens to follow it. A short paragraph of prose taken
// for a caption loses nothing but a size of type, which is the cheaper mistake.
//
// This runs in the renderer and nowhere else. The character counter and the plain-text
// half of Copy read the Markdown, where the caption is still a paragraph of its own:
// it is words like any other, it counts and it is copied.

// mdast has no figure. It is declared here, and mdast-util-to-hast is told what to call
// it in the DOM through `data.hName` — the same door the caption goes through.
declare module "mdast" {
  interface RootContentMap {
    figure: Figure;
  }
}

export type Figure = {
  type: "figure";
  children: Paragraph[];
  data: { hName: "figure" };
};

// Longer than this and it is a paragraph that happens to sit under a picture. Captions
// are a line or two; the model has already shortened whatever the page had.
const CAPTION_MAX = 200;

export function remarkFigures() {
  return (tree: Root): undefined => {
    const children: RootContent[] = [];
    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i];
      const caption = isPictureOnly(node) ? asCaption(tree.children[i + 1]) : null;
      if (caption === null) {
        children.push(node);
        continue;
      }
      caption.data = { ...caption.data, hName: "figcaption" };
      children.push({ type: "figure", data: { hName: "figure" }, children: [node as Paragraph, caption] });
      i++;
    }
    tree.children = children;
  };
}

// A paragraph that is a picture and nothing else. Whitespace around it is what the
// Markdown writer left behind, not content.
function isPictureOnly(node: RootContent): boolean {
  if (node.type !== "paragraph") {
    return false;
  }
  const meaningful = node.children.filter((child) => child.type !== "text" || child.value.trim() !== "");
  return meaningful.length === 1 && meaningful[0].type === "image";
}

// The paragraph after a picture, if it reads like its caption: short, has words in it,
// and is not another picture.
function asCaption(node: RootContent | undefined): Paragraph | null {
  if (node === undefined || node.type !== "paragraph" || hasPicture(node)) {
    return null;
  }
  const text = plainText(node).trim();
  if (text === "" || countCodePoints(text) > CAPTION_MAX) {
    return null;
  }
  return node;
}

function plainText(node: Nodes): string {
  if ("value" in node) {
    return node.value;
  }
  return "children" in node ? node.children.map(plainText).join("") : "";
}

function hasPicture(node: Nodes): boolean {
  if (node.type === "image" || node.type === "imageReference") {
    return true;
  }
  return "children" in node ? node.children.some(hasPicture) : false;
}

import { MAX_INPUT } from "./limits.ts";

// Length is counted in Unicode code points, never in str.length. The latter counts
// UTF-16 units: every emoji weighs two, and on some scripts the extension would count
// twice what the server counts and reject text the server accepts.
export function countCodePoints(text: string): number {
  return [...text].length;
}

// Cutting on code points cannot split a surrogate pair, so nothing else is needed here.
// Grapheme clusters are not respected: an emoji that falls apart exactly on the
// 30 000th character does not matter to this product.
export function truncateToCodePoints(text: string, limit: number): string {
  return [...text].slice(0, limit).join("");
}

export type NormalizedText = {
  text: string;
  truncated: boolean;
};

// Three actions and no others. Leftover navigation, "read more" and captions that
// survived Readability stay as they are: the model reads them and they cost a few
// tokens. Deciding what is content and what is chrome needs the DOM, and by the time
// we hold flat text that signal is gone — any cleanup here would be guesswork, and
// guesswork eats content silently.
export function normalizeText(raw: string): NormalizedText {
  const collapsed = raw
    .replace(/\r\n?/g, "\n")
    // Everything horizontal — spaces, tabs, non-breaking spaces — folds into one space;
    // three or more line breaks fold into two, so paragraphs survive.
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (countCodePoints(collapsed) > MAX_INPUT) {
    return { text: truncateToCodePoints(collapsed, MAX_INPUT), truncated: true };
  }
  return { text: collapsed, truncated: false };
}

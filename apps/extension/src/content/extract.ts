import { Readability } from "@mozilla/readability";

// The lazy half of the content script: hundreds of kilobytes of DOM parsing, loaded by
// a dynamic import from index.ts and only when a whole page is being compressed.
//
// Dirty text is an acceptable result. What is content and what is furniture is decided
// here, on the DOM, while link density and markup are still available — never later on
// the flat string, where the signal is gone.
export function extractPage(): string {
  // Readability mutates the document it is given, so it gets a copy.
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const text = article?.textContent ?? "";
  if (text.trim()) {
    return text;
  }
  // Readability declines on pages that are not articles — a dashboard, a search result
  // page, a forum thread. The visible text is a worse but honest fallback, and the
  // model copes with it; the alternative is telling the user the page is unreadable
  // when it plainly is not.
  return document.body?.innerText ?? "";
}

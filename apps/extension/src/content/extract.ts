import { Readability, isProbablyReaderable } from "@mozilla/readability";

// The lazy half of the content script: hundreds of kilobytes of DOM parsing, loaded by
// a dynamic import from index.ts and only when a whole page is being compressed.
//
// Dirty text is an acceptable result. What is content and what is furniture is decided
// here, on the DOM, while link density and markup are still available — never later on
// the flat string, where the signal is gone.
export function extractPage(): string {
  // The cheap question first: is there an article-shaped body of text on this page at
  // all? A search results page, a dashboard, a feed of cards say no here. Sending their
  // visible text would spend a request and come back as nothing_to_shorten — or worse,
  // as a "shorter" version of forty site descriptions. An empty string is the caller's
  // "this page cannot be read", and the user is pointed at the input field instead.
  if (!isProbablyReaderable(document)) {
    return "";
  }

  // Readability mutates the document it is given, so it gets a copy.
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const text = article?.textContent ?? "";
  if (text.trim()) {
    return text;
  }
  // The page looked readable and Readability still declined — a forum thread, a long
  // comment section. The visible text is a worse but honest fallback, and the model
  // copes with it; the alternative is telling the user the page is unreadable when it
  // plainly is not.
  return document.body?.innerText ?? "";
}

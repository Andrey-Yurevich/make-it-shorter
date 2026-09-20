import type { ExtractedImage } from "./messaging.ts";

// The last step before the result is read: the markers the extraction wrote — "{{img:1}}"
// where the page had a picture — become Markdown images, and everything else about them
// goes away. What comes out is what the panel renders, what the counter counts and what
// Copy puts on the clipboard, so all three agree on what is on screen.
//
// The image is written as "![](1)": the number, not the address. The address lives in
// the table beside the text and is looked up by MarkdownView, which is the only thing
// that ever holds one. A URL the model wrote by itself therefore cannot be fetched — it
// is not a number, and nothing is in the table under it.

// What the model was asked to copy, and what it is forgiven for. The spaces and the
// case are damage it does now and then; the missing closing braces are what a stream cut
// short leaves behind, and a marker is worth more as a picture than as visible wreckage.
// The two opening braces are not forgiven, and that is deliberate: structure.ts escapes
// "{{" to "{ {" in the page's own text, and a reader that accepted a single brace would
// let a page put a picture in the result by writing "{img:1}" in its own prose.
const MARKER = /\{\{\s*img\s*:\s*(\d+)\s*\}?\}?/gi;

// How far back from the end of a stream half a marker can reach: "{{ img : 1234" and a
// little slack.
const MARKER_TAIL = 24;

export function hydrate(markdown: string, images: ExtractedImage[], streaming: boolean): string {
  const known = new Set(images.map((image) => image.id));
  const used = new Set<number>();

  return (streaming ? withoutPartialMarker(markdown) : markdown).replace(MARKER, (_whole, digits: string) => {
    const id = Number(digits);
    // A number with no picture behind it — the model invented it, or renumbered — and a
    // picture claimed twice both leave nothing. Showing the same picture twice is worse
    // than showing it once.
    if (!known.has(id) || used.has(id)) {
      return "";
    }
    used.add(id);
    return `![](${id})`;
  });
}

// A stream ends mid-token several times a second, and "{{img:1" on the way to
// "{{img:12}}" must not flash as text and must not render as picture one. The unfinished
// tail is cut while the run is writing and comes back whole with the next delta.
function withoutPartialMarker(text: string): string {
  for (let i = Math.max(0, text.length - MARKER_TAIL); i < text.length; i++) {
    if (text[i] === "{" && isPartialMarker(text.slice(i))) {
      return text.slice(0, i);
    }
  }
  return text;
}

// Everything a marker could still grow into: the opening braces, part of "img:", and the
// digits before the first closing brace arrives.
function isPartialMarker(tail: string): boolean {
  const compact = tail.replace(/\s+/g, "").toLowerCase();
  return "{{img:".startsWith(compact) || /^\{\{img:\d*$/.test(compact);
}

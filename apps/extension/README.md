# Extension

Chrome MV3, React + TypeScript + Tailwind v4 + shadcn/ui, built with Vite. Product
decisions live in the root `CLAUDE.md`; this file is the package's own notes.

## Layout

| Path | What |
|---|---|
| `manifest.ts` | the manifest, written into `dist/` by a Vite plugin; version from the git tag on HEAD |
| `src/background/index.ts` | service worker: opens the panel on the icon click, injects `content.js`, hands the text to the panel over a port |
| `src/content/index.ts` | content script, one IIFE with Readability inside; answers `extract`, reports selections |
| `src/content/structure.ts` | DOM → text with its shape: headings as bold lines, `- ` / `1. ` items, `\| cell \|` rows, `{{img:N}}` markers and the picture table beside them; tested with linkedom |
| `src/sidepanel/` | the panel: `App.tsx`, the reducer in `state.ts`, the network call in `api.ts` |
| `src/output/` | the "Open in window" page |
| `src/components/` | `MarkdownView` and `CopyButton`, shared by the panel and the window; `ui/` is shadcn |
| `src/shared/` | pure modules with tests: SSE parser, text normalisation, languages, markdown → plain text, `{{img:N}}` → `![](N)`, message readers, storage |
| `public/_locales/` | the 30 catalogs of the strings Chrome itself shows (name, description, icon title) |
| `scripts/` | the two build checks, see below |

## Build

```
../../scripts/frontend-build.sh          # everything below, plus the zip and an unpacked copy in build/extension
npm run build                            # dist/ only
npm test                                 # the pure modules, node --test, no browser
```

`npm run build` runs, in order: the locale check (30 directories, every `messages.json`
parses), the boundary check (every `onMessage` listener parameter and every
`sendMessage` reply is typed `unknown`), `tsc --noEmit`, the unit tests, then two Vite
builds — the panel, the output window and the worker together (`vite.config.ts`), and
`content.js` alone as a single classic script (`vite.content.config.ts`).

**`EXTENSION_KEY`** must be set to the public key of the Chrome Web Store item. Without
it the extension id is random, `Origin` does not match the WAF rule, and every API call
returns 403. The build warns when it is missing.

shadcn components in `src/components/ui` are the stock files for the `new-york` style
with Tailwind v4 and the `radix-ui` package; `components.json` is set up so that
`npx shadcn@latest add <component>` drops new ones in the same place.

## What only a real browser can check

Load `dist/` unpacked (with `EXTENSION_KEY` set) and walk through:

- click the icon on an article: the panel opens with the page text in the field, source
  "page"; select text and click again: the selection replaces it;
- select text (≥ 20 characters) on the same tab while the panel is open: the field
  follows; switching tabs alone changes nothing;
- click the icon on `chrome://extensions` or the web store: the hint "This page has no
  readable text to shorten" under the field, nothing else;
- Shorten: skeleton, then streaming text; once it is done, hovering the result shows a
  strip along its bottom edge with "Open in window" and "Copy" as words, half the width
  each; Copy puts both plain text and HTML on the clipboard and reads "Copied" briefly;
- the language picker shows a flag before each name, following the browser's region
  (Chrome in en-GB: British flag on English; in en-US: American); the tone picker shows
  a pictogram before each tone;
- 15 characters in the field: the hint counts the missing ones and Shorten is disabled;
  no request goes out;
- Shorten twice on the same text works; changing language or tone applies to the next run;
- dark theme follows the system; Arabic output renders right to left;
- the install dialog does not say "read and change all your data on all websites".

## Pictures in the result

The one part of this that no test can settle is whether the model carries the markers
through. Production runs Haiku 4.5, so check there and not only on a newer model. Walk
these, with the network panel open on the first two:

| Page | What to look for |
|---|---|
| A Wikipedia article with an infobox and thumbnails | pictures in the places they held, captions shortened, hotlinking allowed |
| A news site that lazy-loads through `data-src` and `srcset` | the real addresses are requested, not the placeholders |
| Medium or Substack | `<figure>` with a `<figcaption>`: picture, then the caption as a paragraph |
| A selection that starts inside a `<figure>` | the marker without its parent still renders |
| A site that guards against hotlinking | the picture is missing, with no broken-image icon and no gap |
| Pictures behind a login — Confluence, Notion | missing, same as above |
| A page that is nothing but pictures, a gallery | `nothing_to_shorten` |
| Dark theme | a transparent PNG is either legible or knowingly accepted as is |
| Copy into Google Docs, then into a plain editor | the document keeps the pictures, the plain text has none of them and none of their alt text |
| Open in window | the pictures are there too |

The request the panel sends must contain `{{img:1}}` and no address: that is the privacy
claim, and the network panel is where it is confirmed.

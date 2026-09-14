# Extension

Chrome MV3, React + TypeScript + Tailwind v4 + shadcn/ui, built with Vite. Product
decisions live in the root `CLAUDE.md`; this file is the package's own notes.

## Layout

| Path | What |
|---|---|
| `manifest.ts` | the manifest, written into `dist/` by a Vite plugin; version from the git tag on HEAD |
| `src/background/index.ts` | service worker: opens the panel on the icon click, injects `content.js`, hands the text to the panel over a port |
| `src/content/index.ts` | content script, one IIFE with Readability inside; answers `extract`, reports selections |
| `src/content/structure.ts` | DOM → text with its shape: headings as bold lines, `- ` / `1. ` items, `\| cell \|` rows; tested with linkedom |
| `src/sidepanel/` | the panel: `App.tsx`, the reducer in `state.ts`, the network call in `api.ts` |
| `src/output/` | the "Open in window" page |
| `src/components/` | `MarkdownView` and `CopyButton`, shared by the panel and the window; `ui/` is shadcn |
| `src/shared/` | pure modules with tests: SSE parser, text normalisation, languages, markdown → plain text, message readers, storage |
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
- select text (≥ 50 characters) on the same tab while the panel is open: the field
  follows; switching tabs alone changes nothing;
- click the icon on `chrome://extensions` or the web store: the hint "This page has no
  readable text to shorten" under the field, nothing else;
- Shorten: skeleton, then streaming text, then the Copy and Open in window icons; Copy
  puts both plain text and HTML on the clipboard;
- 40 characters in the field: the hint counts the missing ones and Shorten is disabled;
  no request goes out;
- Shorten twice on the same text works; changing language or tone applies to the next run;
- dark theme follows the system; Arabic output renders right to left;
- the install dialog does not say "read and change all your data on all websites".

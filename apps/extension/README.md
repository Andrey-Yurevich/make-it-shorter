# Extension

Chrome MV3, React + TypeScript + Tailwind. The spec is `specs/extension/SPEC.md`; this
file only records what the spec left to the implementation.

## Build

```
../../scripts/frontend-build.sh          # everything below, plus the zip and an unpacked copy
npm run build                            # dist/ only
npm test                                 # shared modules
```

`npm run build` gates on three things before it bundles anything: the locale test (every
catalog id has a label in all 30 locales, none over 24 characters), the type check, and
the unit tests.

**Three Vite builds, not one.** The panel and the service worker may share chunks and are
built together. The content script has to be a classic script — one file, no imports.
The extractor has to be a single self-contained module, because it is imported from
inside the page and only `extract.js` is web-accessible; built together with the rest it
picked up a hashed shared chunk that the page cannot load.

CRXJS was not used. The spec ties the build to Vite and treats CRXJS as a recommendation;
a 40-line plugin that writes the manifest covers what is needed here.

## Before the first store upload

- **`EXTENSION_KEY` is unset.** The build warns about it. Until the store item exists and
  its public key is in `manifest.ts`, the extension id is random, `Origin` does not match
  the WAF rule, and every API call returns 403. Nothing else can be tested end to end
  until this is done.
- `extension_id` in `infra/terraform/terraform.tfvars` is still the placeholder.

## Two things to verify in a real browser first

Both are flagged in the spec as the risky assumptions:

1. `chrome.sidePanel.open()` from the floating icon. The chain is click in the page →
   message → open in the service worker, and it has to fit inside the user-gesture
   window. If it does not, the fallback is to open the panel from the toolbar only.
2. The load-time cost of the content script on a heavy page. It is 2.6 kB and touches
   nothing before the first `mouseup`, but that is an argument, not a measurement.

## Languages

Two lists, and they are not the same one:

- `UI_LOCALES` — the 30 interface locales, keyed by Chrome's `_locales` directory names.
- `SUMMARY_LANGS` — what the settings offer as the language of the summary. It must stay
  inside the server's `LANGUAGES`, so `fa` and `ms` are missing from it: they are
  interface languages the server does not serve yet. Adding them to the Terraform
  `languages` variable is what unblocks them here.

The translations are a single pass. The spec asks for a second, independent pass and a
back-translation check before release, and that has not been done.

# Extension

Chrome MV3, React + TypeScript + Tailwind + shadcn/ui. Decisions live in the root
`CLAUDE.md`; the rewrite in progress is specified in `rewrite-spec.md`.

## Build

```
../../scripts/frontend-build.sh          # everything below, plus the zip and an unpacked copy
npm run build                            # dist/ only
npm test                                 # pure modules
```

`npm run build` gates on the locale check (30 `_locales` directories, every
`messages.json` parses), the message-boundary check (every listener parameter and
`sendMessage` reply is `unknown`), the type check and the unit tests before it bundles.

## Before loading unpacked

**`EXTENSION_KEY` must be set** to the public key of the Chrome Web Store item. Without it
the extension id is random, `Origin` does not match the WAF rule, and every API call
returns 403. The build warns when it is missing.

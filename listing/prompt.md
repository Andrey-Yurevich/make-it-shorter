# Store listing in {language} ({locale})

Rewrite the Chrome Web Store listing of the extension Make It Shorter for people in {market} who speak {language}: the name, the short description and the full description. Work on this one locale only.

The current {language} listing was machine-translated and reads like it. Two old short descriptions from other locales show the problem:

- ru: «ИИ-суммаризатор: краткое изложение или просто короче. Длинная статья? Сожмите её одним кликом, на любом языке.»
- pl: «Streszczenie AI: streszczenie albo po prostu krócej. Długi artykuł? Jedno kliknięcie, w każdym języku.»

A native reader is put off by them, and the reasons are exactly what to avoid:

- The English skeleton survived: a label, a colon, "X or Y", a question fragment, a fragment answer. A native copywriter would never start from that shape.
- The same word twice in one line ("Streszczenie AI: streszczenie").
- A loanword people do not actually use («суммаризатор»), an awkward verb («Сожмите её»).
- Choppy fragments that read like a list of keywords rather than a sentence.

Do not translate sentence by sentence. Take what each sentence tells the reader and say that the way a {language} product page written in {market} would say it. Word order, sentence breaks, idioms and rhythm are yours to choose. The meaning is not: no claim added, none dropped, except where step 3 says so.

## Sources

The English listing is the only source of meaning:

- name and short description: `appName` and `shortDesc` in `apps/extension/public/_locales/en/messages.json`;
- full description: `long-description.txt`.

The rules of the course this listing follows are in `listing-translation-notes.md` (in Russian). The steps below already apply them; read the file only if a step is unclear.

The current texts in `apps/extension/public/_locales/{locale}/messages.json` are the problem being fixed: do not reuse them.

## Step 1. Keywords and name

Semrush database: `{database}`.

**If the database is `none`**, this is not a priority market. Skip Semrush, keep the name `Make It Shorter`, and take the wording for steps 2–3 from your own knowledge of how people in {market} say "shorten a text" and "summarize a text".

**Otherwise** use the Semrush tools (`keyword_research` lists the reports, `get_report_schema` gives a report's parameters, `execute_report` runs it) on database `{database}`. About ten calls is enough.

1. The volume of the English main keyword `make it shorter` in this database.
2. Write down 10–15 {language} phrasings of the same need: what a person in {market} types to get a text shortened or summarized, the natural variants of "shorten text", "make the text shorter", "summarize text", "text summary", "AI summary". Phrasings people use, not dictionary translations. Get their volumes in one `phrase_these` call (semicolon-separated, up to 100), then run `phrase_related` on the two or three strongest to see what people really type.
3. The name. Semrush undercounts searches in national languages roughly tenfold, so multiply the best national phrasing's volume by 10 and compare it with `make it shorter`:
   - within 10× of each other → `<national phrasing> - Make It Shorter`, national first;
   - English 10× or more ahead → `Make It Shorter`;
   - national 10× or more ahead → the national phrasing alone.

   The national phrasing must describe what the extension does and read as a name in {language} (capitalization, word form, spelling). At most 75 characters. For Russian the course takes national volumes from Yandex Wordstat rather than Semrush; Wordstat is not available here, so use Semrush and say so in the report.
4. The best two or three national phrasings are the keywords for steps 2–3.

## Step 2. Short description

At most 132 characters, one or two sentences. On a priority market it opens with the name's national keyword; otherwise with the most natural way to say what the extension does. Say what it does and why it is worth installing, the way a {language} store listing would. The English one is a list of facts to cover: it shortens a sentence or a whole text, it summarizes, you paste text, one click, any language. Use the keyword once. No word twice.

## Step 3. Full description

Translate `long-description.txt` faithfully in meaning and structure — the same sections in the same order, the same emoji, the same list items, the same questions and answers — and natively in wording.

- In the English text `make it shorter` in lowercase is two things at once: the product's name and the English search keyword. Where it names the product, write `Make It Shorter`. On a priority market, use the name's national keyword instead in some of those places, where it reads naturally.
- The English text works English search phrases into its sentences: `summarize`, `summarizer`, `summary generator`, `article summarizer`, `make it short`, `make it way shorter`, `make it as short as possible`, `can u make it short` and the like. Render each the way people in {market} would say it, using the keywords from step 1 where they fit. Never leave the English phrase in place and never transliterate it.
- A line that exists only for English search and means nothing in {language} — the question about the misspelling `summerize`/`summerizer` — becomes the same point about a common {language} misspelling or variant if there is one, and is dropped otherwise. This is the only kind of line you may drop.
- Keywords appear as often as a native writer would naturally use them and no more. Repetition reads as spam to the store's search.
- At most 16,000 characters.

## Everywhere

- The brand Make It Shorter stays in Latin letters and is never translated.
- The extension's interface is English in every locale, so every name the listing takes from it stays in English exactly as written: the button `Shorten`, the tones `Simplified`, `Professional`, `Casual` and `Direct`, and any other button, field or option of the panel (`Copy`, `Open in window`, `Load full page content`). A reader looking for a translated name will not find it on screen. No quotation marks around them. Grammar around the name is yours: the sentence is {language}, only the label is English.
- Parts of Chrome itself (the toolbar, the Chrome Web Store, the PDF viewer) are the opposite case: Chrome is localized, so call them what Chrome calls them in {language}.
- One form of address throughout, the one usual in software store listings in {market}.
- The typography of {language}: quotation marks, dashes, spaces before punctuation where the language has them.
- No `$` sign anywhere: Chrome's message files treat it as a placeholder.

## Step 4. Blind read

Start one subagent and give it only your {language} name, short description and full description: not the English source, not these instructions. Ask it, in English:

> You are a native {language} speaker in {market}, browsing the Chrome Web Store. Read this extension listing. List only the phrases that sound translated, unnatural or awkward to you, each with how a native would say it. Say nothing about what already sounds fine. If nothing jars, say so.

Take the suggestions you agree with, without changing the meaning, the name, the keywords or the English interface names: a native reader will flag those as foreign, and that is expected. One round, no polishing beyond it.

## Step 5. Write and check

Overwrite `apps/extension/public/_locales/{locale}/messages.json` with exactly this structure — these three keys in this order, nothing else, two-space indent:

```json
{
  "appName": {
    "message": "<name>"
  },
  "shortDesc": {
    "message": "<short description>"
  },
  "storeDesc": {
    "message": "<full description, line breaks as \n>"
  }
}
```

Run `node apps/extension/scripts/check-locales.mjs`. It must pass: it parses every locale and checks the length limits, counting characters as Unicode code points.

Then write `listing/{locale}.md`, short, for the owner, who does not read {language}:

```
# {language} ({locale})

## Name
<name> — <English back-translation>
<priority market: the volumes you compared and the rule that applied; otherwise "not a priority market">

## Short description
<text>
<English back-translation>

## Blind read
<what changed after it, a line each, or "no changes">
```

Finish with one line: the name and the short description.

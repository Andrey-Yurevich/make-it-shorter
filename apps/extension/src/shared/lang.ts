// Two separate things live in this file, and they are kept apart on purpose:
//
//   interface language  — chrome.i18n, picks a _locales directory
//   summary language    — the `lang` field of the request, chosen in the panel
//
// The first is Chrome's business and uses Chrome's directory names (zh_CN, pt_BR). The
// second travels over the wire and uses BCP-47 (zh-Hans, pt-BR). The two spellings are
// not the same, hence the map.

// The 30 interface locales, keyed by the _locales directory name. This is the language
// of the store listing and of the strings Chrome itself shows — the extension name, the
// context menu item, the icon tooltip. The panel is English and is not in here.
export const UI_LOCALES: Record<string, string> = {
  en: "en",
  es: "es",
  zh_CN: "zh-Hans",
  zh_TW: "zh-Hant",
  hi: "hi",
  ar: "ar",
  pt_BR: "pt-BR",
  ru: "ru",
  ja: "ja",
  de: "de",
  fr: "fr",
  ko: "ko",
  it: "it",
  tr: "tr",
  pl: "pl",
  nl: "nl",
  id: "id",
  vi: "vi",
  th: "th",
  uk: "uk",
  fa: "fa",
  ms: "ms",
  sv: "sv",
  cs: "cs",
  ro: "ro",
  el: "el",
  hu: "hu",
  da: "da",
  fi: "fi",
  he: "he",
};

// The languages offered for the summary itself. This list is a copy of the server's
// LANGUAGES and must never be wider than it, or the extension offers a language the
// server answers with unsupported_language. Narrower is harmless: the worst case is a
// language the server would have served and nobody was offered.
//
// The line is drawn where the model stops being reliable rather than where speakers run
// out — a summary in a language it half-knows is worse than no summary. Variants are
// split only where the texts genuinely differ: Portuguese and Chinese. Serbian is not
// split by script, and neither is any regional English or Spanish.
export const SUMMARY_LANGS: string[] = [
  // western Europe
  "en",
  "es",
  "pt-BR",
  "pt-PT",
  "fr",
  "de",
  "it",
  "nl",
  "ca",
  "gl",
  // the Nordics
  "sv",
  "da",
  "nb",
  "fi",
  "is",
  // central, eastern and southeastern Europe
  "pl",
  "cs",
  "sk",
  "sl",
  "hr",
  "sr",
  "bg",
  "ro",
  "hu",
  "el",
  "sq",
  "mk",
  // eastern Europe and the Baltics
  "ru",
  "uk",
  "be",
  "lt",
  "lv",
  "et",
  // the Caucasus and central Asia
  "ka",
  "hy",
  "az",
  "kk",
  "uz",
  // the Middle East
  "tr",
  "he",
  "ar",
  "fa",
  "ur",
  // south Asia
  "hi",
  "bn",
  "pa",
  "gu",
  "mr",
  "ta",
  "te",
  "kn",
  "ml",
  // southeast Asia
  "th",
  "vi",
  "id",
  "ms",
  "tl",
  // east Asia
  "zh-Hans",
  "zh-Hant",
  "ja",
  "ko",
  // Africa
  "sw",
  "af",
];

export const RTL_LANGS = new Set(["ar", "fa", "he", "ur"]);

// Codes some browsers still emit for languages the list above spells the modern way.
// Folding them here rather than adding both spellings to the list keeps one entry per
// language in the picker.
const LEGACY_CODES: Record<string, string> = {
  no: "nb", // the macrolanguage, written as Bokmål in practice
  iw: "he", // the pre-1989 code for Hebrew
  fil: "tl",
};

// BCP-47 folded onto the whitelist, with a fallback. The server normalises separately
// and by its own copy of these rules — the two are allowed to disagree as long as this
// list stays inside the server's.
export function normalizeLang(tag: string): string {
  const parts = tag.trim().split("-");
  const subtags = new Set(parts.slice(1).map((part) => part.toLowerCase()));
  const lowered = parts[0].toLowerCase();
  const base = LEGACY_CODES[lowered] ?? lowered;

  if (base === "zh") {
    return subtags.has("hant") || subtags.has("tw") || subtags.has("hk") || subtags.has("mo")
      ? "zh-Hant"
      : "zh-Hans";
  }
  if (base === "pt") {
    return subtags.has("pt") ? "pt-PT" : "pt-BR";
  }
  // Unknown falls back to English rather than being reported: an interface language we
  // do not serve is not an error the user can act on.
  return SUMMARY_LANGS.includes(base) ? base : "en";
}

// The _locales directory the interface is running in. Chrome resolves messages.json on
// its own; this is for the code that needs to know which one it picked.
export function localeDirForUI(uiLanguage: string): string {
  const parts = uiLanguage.trim().split("-");
  const base = parts[0].toLowerCase();
  const subtags = new Set(parts.slice(1).map((part) => part.toLowerCase()));

  if (base === "zh") {
    return subtags.has("hant") || subtags.has("tw") || subtags.has("hk") || subtags.has("mo")
      ? "zh_TW"
      : "zh_CN";
  }
  if (base === "pt") {
    return "pt_BR";
  }
  return base in UI_LOCALES ? base : "en";
}

// English names, because the panel is English: a list that reads "Deutsch, Français,
// 日本語" in an otherwise English interface is a list the reader cannot scan. Chrome
// supplies the names and needs no data of ours, and it knows the variants the list
// splits — pt-BR is "Brazilian Portuguese", zh-Hant is "Traditional Chinese".
export function languageName(code: string): string {
  return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
}

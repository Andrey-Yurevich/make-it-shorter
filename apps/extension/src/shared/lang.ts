// Three separate things live in this file, and the spec keeps them apart on purpose:
//
//   interface language  — chrome.i18n, picks a _locales directory
//   button labels       — same language as the interface, _locales/<dir>/buttons.json
//   summary language    — the `lang` field of the request, chosen in settings
//
// The first two are Chrome's business and use Chrome's directory names (zh_CN, pt_BR).
// The third travels over the wire and uses BCP-47 (zh-Hans, pt-BR). The two spellings
// are not the same, hence the map.

// The 30 interface locales of the spec, keyed by the _locales directory name.
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

// The languages offered for the summary itself. This list must never be wider than the
// server's LANGUAGES, or the extension offers a language the server answers with
// unsupported_language. fa and ms are interface languages but are not on the server
// list today; a Persian interface therefore summarises in English until they are added
// there, which is the harmless direction of the disagreement.
export const SUMMARY_LANGS: string[] = [
  "en",
  "es",
  "zh-Hans",
  "zh-Hant",
  "hi",
  "ar",
  "pt-BR",
  "ru",
  "ja",
  "de",
  "fr",
  "ko",
  "it",
  "tr",
  "pl",
  "nl",
  "id",
  "vi",
  "th",
  "uk",
  "sv",
  "cs",
  "ro",
  "el",
  "hu",
  "da",
  "fi",
  "he",
];

export const RTL_LANGS = new Set(["ar", "fa", "he"]);

// BCP-47 folded onto the whitelist, with a fallback. Portuguese and Chinese keep their
// variants; English, Spanish and French ones do not. The server normalises separately
// and by its own copy of these rules — the two are allowed to disagree as long as this
// list stays inside the server's.
export function normalizeLang(tag: string): string {
  const parts = tag.trim().split("-");
  const base = parts[0].toLowerCase();
  const subtags = new Set(parts.slice(1).map((part) => part.toLowerCase()));

  if (base === "zh") {
    return subtags.has("hant") || subtags.has("tw") || subtags.has("hk") || subtags.has("mo")
      ? "zh-Hant"
      : "zh-Hans";
  }
  if (base === "pt") {
    return "pt-BR";
  }
  // Unknown falls back to English rather than being reported: an interface language we
  // do not serve is not an error the user can act on.
  return SUMMARY_LANGS.includes(base) ? base : "en";
}

// The _locales directory the interface is running in. Chrome resolves messages.json on
// its own, but buttons.json is our file and nobody resolves it for us.
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

// The short badge on the language button: an ISO 639-2 code and a flag. Written out by
// hand rather than derived, because there is nothing to derive it from — a language is
// not a country, and for English, Spanish and Arabic the flag below is a convention,
// not a fact. Chrome on Windows has no flag font and draws the pair as two letters.
export const LANG_BADGES: Record<string, string> = {
  en: "ENG🇺🇸",
  es: "SPA🇪🇸",
  "zh-Hans": "CHS🇨🇳",
  "zh-Hant": "CHT🇹🇼",
  hi: "HIN🇮🇳",
  ar: "ARA🇸🇦",
  "pt-BR": "POR🇧🇷",
  ru: "RUS🇷🇺",
  ja: "JPN🇯🇵",
  de: "DEU🇩🇪",
  fr: "FRA🇫🇷",
  ko: "KOR🇰🇷",
  it: "ITA🇮🇹",
  tr: "TUR🇹🇷",
  pl: "POL🇵🇱",
  nl: "NLD🇳🇱",
  id: "IND🇮🇩",
  vi: "VIE🇻🇳",
  th: "THA🇹🇭",
  uk: "UKR🇺🇦",
  sv: "SWE🇸🇪",
  cs: "CES🇨🇿",
  ro: "RON🇷🇴",
  el: "ELL🇬🇷",
  hu: "HUN🇭🇺",
  da: "DAN🇩🇰",
  fi: "FIN🇫🇮",
  he: "HEB🇮🇱",
};

// Endonyms from the browser, so the list reads the same whatever the interface language
// is. Intl.DisplayNames is in Chrome and needs no data of ours.
export function languageName(code: string): string {
  return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
}

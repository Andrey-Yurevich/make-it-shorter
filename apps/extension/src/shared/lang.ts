// The languages the shorter text can be written in: the wire code, the label the picker
// shows, and the region whose flag is drawn next to it. The labels are English literals,
// not Intl.DisplayNames — the panel is English, and a fixed list is the same on every
// machine. The server carries the same 57 codes in its LANGUAGES variable and
// languageNames table; this list may never be wider than that one, or the picker offers
// a language answered with unsupported_language.
//
// No variant is split: Portuguese is one entry, Chinese is one entry (written as
// Simplified), Serbian is one entry whatever the script. Sorted by label.
//
// `region` is the home region, an ISO 3166-1 alpha-2 code: the flag shown when the
// browser says nothing about where its user reads the language. Where a language has
// several homes (English, Spanish, Portuguese, Arabic, the languages of India) the pick
// is the largest or the eponymous country; the browser's own tags override it, see
// languageFlag below.
export type Language = { code: string; label: string; region: string };

export const LANGUAGES: Language[] = [
  { code: "af", label: "Afrikaans", region: "ZA" },
  { code: "sq", label: "Albanian", region: "AL" },
  { code: "ar", label: "Arabic", region: "SA" },
  { code: "hy", label: "Armenian", region: "AM" },
  { code: "az", label: "Azerbaijani", region: "AZ" },
  { code: "bn", label: "Bangla", region: "BD" },
  { code: "be", label: "Belarusian", region: "BY" },
  { code: "bg", label: "Bulgarian", region: "BG" },
  { code: "zh", label: "Chinese", region: "CN" },
  { code: "hr", label: "Croatian", region: "HR" },
  { code: "cs", label: "Czech", region: "CZ" },
  { code: "da", label: "Danish", region: "DK" },
  { code: "nl", label: "Dutch", region: "NL" },
  { code: "en", label: "English", region: "US" },
  { code: "et", label: "Estonian", region: "EE" },
  { code: "tl", label: "Filipino", region: "PH" },
  { code: "fi", label: "Finnish", region: "FI" },
  { code: "fr", label: "French", region: "FR" },
  { code: "ka", label: "Georgian", region: "GE" },
  { code: "de", label: "German", region: "DE" },
  { code: "el", label: "Greek", region: "GR" },
  { code: "gu", label: "Gujarati", region: "IN" },
  { code: "he", label: "Hebrew", region: "IL" },
  { code: "hi", label: "Hindi", region: "IN" },
  { code: "hu", label: "Hungarian", region: "HU" },
  { code: "id", label: "Indonesian", region: "ID" },
  { code: "it", label: "Italian", region: "IT" },
  { code: "ja", label: "Japanese", region: "JP" },
  { code: "kk", label: "Kazakh", region: "KZ" },
  { code: "ko", label: "Korean", region: "KR" },
  { code: "lv", label: "Latvian", region: "LV" },
  { code: "lt", label: "Lithuanian", region: "LT" },
  { code: "mk", label: "Macedonian", region: "MK" },
  { code: "ms", label: "Malay", region: "MY" },
  { code: "ml", label: "Malayalam", region: "IN" },
  { code: "mr", label: "Marathi", region: "IN" },
  { code: "nb", label: "Norwegian", region: "NO" },
  { code: "fa", label: "Persian", region: "IR" },
  { code: "pl", label: "Polish", region: "PL" },
  { code: "pt", label: "Portuguese", region: "PT" },
  { code: "pa", label: "Punjabi", region: "IN" },
  { code: "ro", label: "Romanian", region: "RO" },
  { code: "ru", label: "Russian", region: "RU" },
  { code: "sr", label: "Serbian", region: "RS" },
  { code: "sk", label: "Slovak", region: "SK" },
  { code: "sl", label: "Slovenian", region: "SI" },
  { code: "es", label: "Spanish", region: "ES" },
  { code: "sw", label: "Swahili", region: "KE" },
  { code: "sv", label: "Swedish", region: "SE" },
  { code: "ta", label: "Tamil", region: "IN" },
  { code: "te", label: "Telugu", region: "IN" },
  { code: "th", label: "Thai", region: "TH" },
  { code: "tr", label: "Turkish", region: "TR" },
  { code: "uk", label: "Ukrainian", region: "UA" },
  { code: "ur", label: "Urdu", region: "PK" },
  { code: "uz", label: "Uzbek", region: "UZ" },
  { code: "vi", label: "Vietnamese", region: "VN" },
];

const LANGUAGE_CODES = new Set(LANGUAGES.map((language) => language.code));

// Written right to left: the output container gets dir="rtl" for these.
export const RTL_LANGS = new Set(["ar", "fa", "he", "ur"]);

export function isRtl(code: string): boolean {
  return RTL_LANGS.has(code);
}

// Codes some browsers still emit for languages the list above spells the modern way.
const ALIASES: Record<string, string> = {
  no: "nb", // the macrolanguage, written as Bokmål in practice
  iw: "he", // the pre-1989 code for Hebrew
  fil: "tl",
  in: "id", // the pre-1989 code for Indonesian
};

// A BCP-47 tag folded onto the list: the base subtag in lower case, aliases applied,
// every regional and script subtag dropped (pt-BR → pt, zh-TW → zh, en-US → en). This
// is applied to the browser's language and to the stored value only; the code goes to
// the server as it is. Unknown falls back to English rather than being reported: an
// interface language we do not serve is not an error the user can act on. The server
// normalises separately, by its own copy of these rules.
export function normalizeLang(tag: string): string {
  const base = tag.trim().split("-")[0].toLowerCase();
  const code = ALIASES[base] ?? base;
  return LANGUAGE_CODES.has(code) ? code : "en";
}

// The flag next to a language in the picker. The browser's own tags — its UI language
// and the accept languages, in that order — are searched for the first one naming this
// language with a region: an American's English is under the American flag, a Briton's
// under the British one, a Brazilian's Portuguese under the Brazilian one. Without such
// a tag the home region's flag is drawn. The region has to be two letters: es-419 names
// a continent, and there is no flag for it.
export function languageFlag(language: Language, browserTags: readonly string[]): string {
  for (const tag of browserTags) {
    if (normalizeLang(tag) !== language.code) {
      continue;
    }
    const region = tag
      .split("-")
      .slice(1)
      .find((subtag) => /^[A-Za-z]{2}$/.test(subtag));
    if (region) {
      return flagEmoji(region);
    }
  }
  return flagEmoji(language.region);
}

// Two regional indicator symbols make one flag: "US" → 🇺🇸.
export function flagEmoji(region: string): string {
  const REGIONAL_INDICATOR_A = 0x1f1e6;
  return String.fromCodePoint(
    ...[...region.toUpperCase()].map((letter) => REGIONAL_INDICATOR_A + letter.charCodeAt(0) - "A".charCodeAt(0)),
  );
}

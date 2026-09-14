// The languages the shorter text can be written in: the wire code and the label the
// picker shows. The labels are English literals, not Intl.DisplayNames — the panel is
// English, and a fixed list is the same on every machine. The server carries the same
// 57 codes in its LANGUAGES variable and languageNames table; this list may never be
// wider than that one, or the picker offers a language answered with
// unsupported_language.
//
// No variant is split: Portuguese is one entry, Chinese is one entry (written as
// Simplified), Serbian is one entry whatever the script. Sorted by label.
export type Language = { code: string; label: string };

export const LANGUAGES: Language[] = [
  { code: "af", label: "Afrikaans" },
  { code: "sq", label: "Albanian" },
  { code: "ar", label: "Arabic" },
  { code: "hy", label: "Armenian" },
  { code: "az", label: "Azerbaijani" },
  { code: "bn", label: "Bangla" },
  { code: "be", label: "Belarusian" },
  { code: "bg", label: "Bulgarian" },
  { code: "zh", label: "Chinese" },
  { code: "hr", label: "Croatian" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "en", label: "English" },
  { code: "et", label: "Estonian" },
  { code: "tl", label: "Filipino" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "ka", label: "Georgian" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "gu", label: "Gujarati" },
  { code: "he", label: "Hebrew" },
  { code: "hi", label: "Hindi" },
  { code: "hu", label: "Hungarian" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "kk", label: "Kazakh" },
  { code: "ko", label: "Korean" },
  { code: "lv", label: "Latvian" },
  { code: "lt", label: "Lithuanian" },
  { code: "mk", label: "Macedonian" },
  { code: "ms", label: "Malay" },
  { code: "ml", label: "Malayalam" },
  { code: "mr", label: "Marathi" },
  { code: "nb", label: "Norwegian" },
  { code: "fa", label: "Persian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "pa", label: "Punjabi" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "sr", label: "Serbian" },
  { code: "sk", label: "Slovak" },
  { code: "sl", label: "Slovenian" },
  { code: "es", label: "Spanish" },
  { code: "sw", label: "Swahili" },
  { code: "sv", label: "Swedish" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "ur", label: "Urdu" },
  { code: "uz", label: "Uzbek" },
  { code: "vi", label: "Vietnamese" },
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

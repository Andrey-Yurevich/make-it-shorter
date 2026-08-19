import assert from "node:assert/strict";
import test from "node:test";
import {
  SUMMARY_LANGS,
  UI_LOCALES,
  languageName,
  localeDirForUI,
  normalizeLang,
} from "./lang.ts";

test("regional tags fold onto the whitelist", () => {
  assert.equal(normalizeLang("ru-RU"), "ru");
  assert.equal(normalizeLang("en-GB"), "en");
  assert.equal(normalizeLang("es-419"), "es");
  // Serbian is offered once, not once per script.
  assert.equal(normalizeLang("sr-Latn"), "sr");
  assert.equal(normalizeLang("sr-Cyrl-RS"), "sr");
});

test("Chinese and Portuguese keep the variants that differ", () => {
  assert.equal(normalizeLang("zh-TW"), "zh-Hant");
  assert.equal(normalizeLang("zh-HK"), "zh-Hant");
  assert.equal(normalizeLang("zh"), "zh-Hans");
  assert.equal(normalizeLang("pt"), "pt-BR");
  assert.equal(normalizeLang("pt-PT"), "pt-PT");
  assert.equal(normalizeLang("pt-BR"), "pt-BR");
});

test("legacy codes fold onto the modern spelling", () => {
  assert.equal(normalizeLang("no"), "nb");
  assert.equal(normalizeLang("nb-NO"), "nb");
  assert.equal(normalizeLang("iw"), "he");
  assert.equal(normalizeLang("fil-PH"), "tl");
});

test("an unknown tag falls back to English rather than being reported", () => {
  assert.equal(normalizeLang("kl-GL"), "en");
});

// The invariant that keeps the client from being stricter than the server: everything
// offered as a summary language has to survive normalisation unchanged, or the picker
// sends a code the request then folds into a different one.
test("every summary language is stable under normalisation", () => {
  assert.ok(SUMMARY_LANGS.length >= 50, `only ${SUMMARY_LANGS.length} summary languages`);
  assert.equal(new Set(SUMMARY_LANGS).size, SUMMARY_LANGS.length, "duplicate summary language");

  for (const code of SUMMARY_LANGS) {
    assert.equal(normalizeLang(code), code, `${code} is not stable under normalisation`);
  }
});

// Every interface locale has to be a language the summary can be written in too, or a
// fresh install defaults its output language to English while its interface is not.
test("every UI locale maps to a summary language and back to its directory", () => {
  for (const [dir, code] of Object.entries(UI_LOCALES)) {
    assert.ok(SUMMARY_LANGS.includes(code), `${code} is a UI locale but not a summary language`);
    assert.equal(localeDirForUI(code), dir, `${code} does not map back to ${dir}`);
  }
});

test("the interface locale directory follows Chrome's naming", () => {
  assert.equal(localeDirForUI("zh-TW"), "zh_TW");
  assert.equal(localeDirForUI("zh-CN"), "zh_CN");
  assert.equal(localeDirForUI("pt-PT"), "pt_BR");
  assert.equal(localeDirForUI("de-AT"), "de");
  assert.equal(localeDirForUI("kl-GL"), "en");
});

// The panel is English, so the picker is English: the names have to read as English
// words and the split variants have to name what they are.
test("language names come out in English", () => {
  assert.equal(languageName("de"), "German");
  assert.equal(languageName("ja"), "Japanese");
  assert.equal(languageName("pt-BR"), "Brazilian Portuguese");
  assert.equal(languageName("zh-Hant"), "Traditional Chinese");

  for (const code of SUMMARY_LANGS) {
    const name = languageName(code);
    assert.notEqual(name, code, `${code} has no English name and would show as its code`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { LANGUAGES, isRtl, normalizeLang } from "./lang.ts";

test("regional and script subtags are dropped", () => {
  assert.equal(normalizeLang("ru-RU"), "ru");
  assert.equal(normalizeLang("en-GB"), "en");
  assert.equal(normalizeLang("EN-us"), "en");
  assert.equal(normalizeLang("es-419"), "es");
  assert.equal(normalizeLang("sr-Latn"), "sr");
  assert.equal(normalizeLang("sr-Cyrl-RS"), "sr");
});

// The variants the previous build split. Their stored values must land on the single
// entry, not on English.
test("Portuguese and Chinese variants fold onto one entry", () => {
  assert.equal(normalizeLang("pt-BR"), "pt");
  assert.equal(normalizeLang("pt-PT"), "pt");
  assert.equal(normalizeLang("pt"), "pt");
  assert.equal(normalizeLang("zh-Hans"), "zh");
  assert.equal(normalizeLang("zh-Hant"), "zh");
  assert.equal(normalizeLang("zh-TW"), "zh");
  assert.equal(normalizeLang("zh"), "zh");
});

test("legacy codes fold onto the modern spelling", () => {
  assert.equal(normalizeLang("no"), "nb");
  assert.equal(normalizeLang("nb-NO"), "nb");
  assert.equal(normalizeLang("iw"), "he");
  assert.equal(normalizeLang("fil-PH"), "tl");
  assert.equal(normalizeLang("in"), "id");
});

test("an unknown tag falls back to English rather than being reported", () => {
  assert.equal(normalizeLang("kl-GL"), "en");
  assert.equal(normalizeLang(""), "en");
});

// The list is the contract with the server: 57 codes, each one stable under
// normalisation — or the picker shows a code the request then folds into another.
test("the list has 57 unique codes, each stable under normalisation", () => {
  assert.equal(LANGUAGES.length, 57);
  assert.equal(new Set(LANGUAGES.map((language) => language.code)).size, 57, "duplicate code");
  assert.equal(new Set(LANGUAGES.map((language) => language.label)).size, 57, "duplicate label");
  for (const { code } of LANGUAGES) {
    assert.equal(normalizeLang(code), code, `${code} is not stable under normalisation`);
  }
});

test("the list is sorted by label", () => {
  const labels = LANGUAGES.map((language) => language.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, "en")));
});

test("right-to-left languages are the four the spec names", () => {
  for (const code of ["ar", "fa", "he", "ur"]) {
    assert.ok(isRtl(code), code);
  }
  assert.equal(isRtl("en"), false);
});

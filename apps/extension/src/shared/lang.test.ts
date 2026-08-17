import assert from "node:assert/strict";
import test from "node:test";
import { SUMMARY_LANGS, UI_LOCALES, localeDirForUI, normalizeLang } from "./lang.ts";

test("regional tags fold onto the whitelist", () => {
  assert.equal(normalizeLang("ru-RU"), "ru");
  assert.equal(normalizeLang("en-GB"), "en");
  assert.equal(normalizeLang("es-419"), "es");
});

test("Chinese and Portuguese keep the variants that differ", () => {
  assert.equal(normalizeLang("zh-TW"), "zh-Hant");
  assert.equal(normalizeLang("zh-HK"), "zh-Hant");
  assert.equal(normalizeLang("zh"), "zh-Hans");
  assert.equal(normalizeLang("pt-PT"), "pt-BR");
});

test("an unknown tag falls back to English rather than being reported", () => {
  assert.equal(normalizeLang("kl-GL"), "en");
});

// The invariant that keeps the client from being stricter than the server: everything
// offered as a summary language has to be a language the server serves.
test("every summary language is a real code and every UI locale maps to one", () => {
  for (const code of SUMMARY_LANGS) {
    assert.equal(normalizeLang(code), code, `${code} is not stable under normalisation`);
  }
  for (const [dir, code] of Object.entries(UI_LOCALES)) {
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

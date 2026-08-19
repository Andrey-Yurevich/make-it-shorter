// A build test over _locales. Chrome refuses to load an extension whose locale
// directory has no readable messages.json, and it refuses it at install time with a
// message that says nothing useful — so the file is parsed here, where the failure is
// legible, rather than discovered in the store review queue.
//
// Only the strings Chrome itself shows live in these files: the extension name, the
// description, the context menu item, the icon tooltip. The panel is English and its
// text is in the code.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const localesDir = resolve(root, "public/_locales");

const problems = [];
const locales = readdirSync(localesDir).sort();

if (locales.length !== 30) {
  problems.push(`expected 30 locales, found ${locales.length}`);
}

for (const locale of locales) {
  try {
    JSON.parse(readFileSync(resolve(localesDir, locale, "messages.json"), "utf8"));
  } catch (error) {
    problems.push(`${locale}/messages.json: ${error.message}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${locales.length} locales, every messages.json parses`);

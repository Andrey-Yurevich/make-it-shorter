// A build test over _locales. Chrome refuses to load an extension whose locale
// directory has no readable messages.json, and it refuses it at install time with a
// message that says nothing useful — so the file is parsed here, where the failure is
// legible, rather than discovered in the store review queue.
//
// Only the listing lives in these files: the name (also the icon tooltip) and the short
// description, which Chrome shows, and the store's full description, which the manifest
// does not reference and the store upload reads from here. The panel is English and its
// text is in the code.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const localesDir = resolve(root, "public/_locales");

// Every catalog has exactly these keys, and each is held to the store's limit. A name or
// a short description over it is refused or cut at upload, long after the build that
// could have said so. Counted in code points, the project's one unit of length.
const limits = { appName: 75, shortDesc: 132, storeDesc: 16000 };

const problems = [];
const locales = readdirSync(localesDir).sort();

if (locales.length !== 30) {
  problems.push(`expected 30 locales, found ${locales.length}`);
}

for (const locale of locales) {
  let messages;
  try {
    messages = JSON.parse(readFileSync(resolve(localesDir, locale, "messages.json"), "utf8"));
  } catch (error) {
    problems.push(`${locale}/messages.json: ${error.message}`);
    continue;
  }
  const keys = Object.keys(messages);
  if (keys.join() !== Object.keys(limits).join()) {
    problems.push(`${locale}/messages.json: keys are ${keys.join(", ")}, expected ${Object.keys(limits).join(", ")}`);
  }
  for (const [key, limit] of Object.entries(limits)) {
    const message = messages[key]?.message;
    if (typeof message !== "string") {
      problems.push(`${locale}/messages.json: ${key}.message is not a string`);
    } else if ([...message].length > limit) {
      problems.push(`${locale}/messages.json: ${key} is ${[...message].length} characters, the limit is ${limit}`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${locales.length} locales, every messages.json parses and fits the store's limits`);

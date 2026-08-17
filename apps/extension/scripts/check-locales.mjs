// The build test from the spec: every id in catalog.json has a label in all 30
// _locales/<dir>/buttons.json. It fails the build, because a missing label is a button
// the user sees as nothing at all.
//
// Deprecated ids are checked too: such an id is no longer offered, but it sits in
// people's local history, and the label for it has to be there.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const catalog = JSON.parse(readFileSync(resolve(root, "../../catalog.json"), "utf8"));
const localesDir = resolve(root, "public/_locales");

const problems = [];

// The invariant from the spec: version equals the highest `since` in the file.
const highestSince = Math.max(...catalog.actions.map((action) => action.since));
if (catalog.version !== highestSince) {
  problems.push(`catalog version is ${catalog.version} but the highest since is ${highestSince}`);
}

const ids = catalog.actions.map((action) => action.id);
const locales = readdirSync(localesDir).sort();

if (locales.length !== 30) {
  problems.push(`expected 30 locales, found ${locales.length}`);
}

for (const locale of locales) {
  for (const file of ["messages.json", "buttons.json"]) {
    // Chrome refuses to load an extension whose locale directory has no messages.json,
    // so both files are checked, not only the one with the labels.
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(resolve(localesDir, locale, file), "utf8"));
    } catch (error) {
      problems.push(`${locale}/${file}: ${error.message}`);
      continue;
    }
    if (file !== "buttons.json") {
      continue;
    }
    for (const id of ids) {
      const label = parsed[id];
      if (typeof label !== "string" || label === "") {
        problems.push(`${locale}/buttons.json: no label for "${id}"`);
        continue;
      }
      // Labels are the most visible text in the product; a long one is rewritten, never
      // truncated, so the limit is enforced here rather than in CSS.
      if ([...label].length > 24) {
        problems.push(`${locale}/buttons.json: "${id}" is ${[...label].length} characters, over 24`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`catalog v${catalog.version}: ${ids.length} ids × ${locales.length} locales, all labelled`);

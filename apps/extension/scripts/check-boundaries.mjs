// A build test over the message boundaries. It enforces one rule:
//
//   a value arriving from another process is annotated `unknown`, never a shape.
//
// The rule exists because of a specific bug. The panel's port listener was written as
// `(message: PanelMessage)`, which is not a check — it is an instruction to the compiler
// to stop looking. A job with no text came through it, `undefined` reached the input
// field, and every render after that threw while counting the length of it. React
// unmounted the panel and it stayed blank long after the message that broke it, with
// `strict: true` on the whole time: there is no compiler setting that catches a type the
// programmer asserted by hand.
//
// Annotating the parameter `unknown` puts the compiler back to work. The value cannot
// then be used at all until something narrows it, and the readers in shared/messaging.ts
// are where that happens. So this file is small on purpose: it guards the one thing tsc
// cannot, and tsc does the rest.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "src");

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const problems = [];

for (const file of sourceFiles(sourceDir)) {
  const source = readFileSync(file, "utf8");
  const where = file.slice(root.length + 1);

  // The first parameter of a message listener is the message. Anything but `unknown`
  // there — including no annotation at all, which the chrome typings widen to `any` —
  // is a shape taken on trust.
  for (const match of source.matchAll(/\.onMessage\.addListener\(\s*\(\s*(\w+)\s*(?::\s*([^,)]+?)\s*)?[,)]/g)) {
    const [, parameter, annotation] = match;
    if (annotation?.trim() !== "unknown") {
      problems.push(
        `${where}: onMessage listener takes \`${parameter}${annotation ? `: ${annotation.trim()}` : ""}\`. ` +
          `Message parameters are \`unknown\` and are narrowed by a reader in shared/messaging.ts.`,
      );
    }
  }

  // The reply to sendMessage crosses the same boundary in the other direction, and the
  // second type argument is the same promise made to the compiler.
  for (const match of source.matchAll(/\b(?:tabs|runtime)\.sendMessage\s*<([^>]+)>/g)) {
    const response = match[1].split(",").pop().trim();
    if (response !== "unknown") {
      problems.push(
        `${where}: sendMessage declares its reply as \`${response}\`. ` +
          `Replies are \`unknown\` and are narrowed before use — an old content script in a tab ` +
          `that stayed open across a reload answers in the shape it had then.`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("message boundaries:\n" + problems.map((problem) => `  ${problem}`).join("\n"));
  process.exit(1);
}

console.log("message boundaries: every listener and reply is unknown");

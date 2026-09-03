import assert from "node:assert/strict";
import test from "node:test";

// extractFromTab is the only place a reply from a foreign page enters the extension, so
// the shapes that are not an ExtractResult are pinned here. The one that mattered is the
// third case: it answered without throwing, travelled on as ok with no text, and put
// undefined in the input field, after which every render of the panel threw.

type Reply = unknown | (() => never);

function stubChrome(replies: Reply[]): void {
  let call = 0;
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      sendMessage: async () => {
        const reply = replies[Math.min(call++, replies.length - 1)];
        if (typeof reply === "function") {
          return (reply as () => never)();
        }
        return reply;
      },
    },
    scripting: { executeScript: async () => [] },
  };
}

async function extract() {
  // Imported per test: the module reads chrome at call time, but a fresh import keeps
  // the stubs from leaking between cases.
  const { extractFromTab } = await import(`./tab.ts?${Math.random()}`);
  return extractFromTab(1, "page");
}

test("a well-formed reply passes through", async () => {
  stubChrome([{ ok: true, text: "hello", truncated: false }]);
  assert.deepEqual(await extract(), { ok: true, text: "hello", truncated: false });
});

test("a refusal stays a refusal", async () => {
  stubChrome([{ ok: false }]);
  assert.deepEqual(await extract(), { ok: false });
});

test("ok with no text is not a readable page", async () => {
  // An older content script left in a tab that stayed open across a reload. It answers
  // successfully, so the executeScript fallback never runs and this is the shape the
  // panel used to receive.
  stubChrome([{ ok: true, content: "text under an old name" }]);
  assert.deepEqual(await extract(), { ok: false });
});

test("no listener at all resolves to undefined, not a crash", async () => {
  stubChrome([undefined]);
  assert.deepEqual(await extract(), { ok: false });
});

test("a thrown reply falls back to injecting the script", async () => {
  stubChrome([
    () => {
      throw new Error("Receiving end does not exist");
    },
    { ok: true, text: "after injection", truncated: true },
  ]);
  assert.deepEqual(await extract(), { ok: true, text: "after injection", truncated: true });
});

test("truncated is always a boolean, whatever the page sent", async () => {
  stubChrome([{ ok: true, text: "hello" }]);
  assert.deepEqual(await extract(), { ok: true, text: "hello", truncated: false });
});

import assert from "node:assert/strict";
import test from "node:test";
import { SSEParser } from "./sse.ts";

const encoder = new TextEncoder();

// The two failure modes the spec calls out. Neither shows up against a mock, so they are
// reproduced here by chopping the stream by hand.

test("a frame split across chunks is assembled", () => {
  const parser = new SSEParser();
  assert.deepEqual(parser.push(encoder.encode('event: delta\ndata: {"text":"half')), []);
  assert.deepEqual(parser.push(encoder.encode(' a summary"}\n\n')), [
    { type: "delta", text: "half a summary" },
  ]);
});

test("a multi-byte character split across chunks survives", () => {
  const parser = new SSEParser();
  const bytes = encoder.encode('event: delta\ndata: {"text":"Привет"}\n\n');
  // Cut inside the two bytes of "и".
  const cut = bytes.indexOf(encoder.encode("и")[0]) + 1;

  assert.deepEqual(parser.push(bytes.slice(0, cut)), []);
  assert.deepEqual(parser.push(bytes.slice(cut)), [{ type: "delta", text: "Привет" }]);
});

test("several frames in one chunk come out in order", () => {
  const parser = new SSEParser();
  const events = parser.push(
    encoder.encode(
      'event: delta\ndata: {"text":"first "}\n\n' +
        'event: delta\ndata: {"text":"second"}\n\n' +
        'event: done\ndata: {"tokensIn":10,"tokensOut":20}\n\n',
    ),
  );
  assert.deepEqual(events, [
    { type: "delta", text: "first " },
    { type: "delta", text: "second" },
    { type: "done" },
  ]);
});

// Comment lines and event names the client does not know are ignored by the SSE
// standard, and this is what lets the server add an event without breaking old builds.
test("comment lines and unknown events are dropped silently", () => {
  const parser = new SSEParser();
  const events = parser.push(
    encoder.encode(
      ": ping\n\n" +
        'event: tomorrows_event\ndata: {"whatever":1}\n\n' +
        'event: delta\ndata: {"text":"x"}\n\n',
    ),
  );
  assert.deepEqual(events, [{ type: "delta", text: "x" }]);
});

test("done without token fields still parses", () => {
  const parser = new SSEParser();
  assert.deepEqual(parser.push(encoder.encode("event: done\ndata: {}\n\n")), [{ type: "done" }]);
});

test("error carries its code, and a message only when the server sent one", () => {
  const parser = new SSEParser();
  assert.deepEqual(parser.push(encoder.encode('event: error\ndata: {"code":"rate_limited"}\n\n')), [
    { type: "error", code: "rate_limited", message: undefined },
  ]);
  assert.deepEqual(
    parser.push(
      encoder.encode('event: error\ndata: {"code":"service_disabled","message":"Back at 18:00 UTC"}\n\n'),
    ),
    [{ type: "error", code: "service_disabled", message: "Back at 18:00 UTC" }],
  );
});

test("an unknown error code is not an error event", () => {
  const parser = new SSEParser();
  assert.deepEqual(parser.push(encoder.encode('event: error\ndata: {"code":"teapot"}\n\n')), []);
});

test("malformed JSON is dropped without taking the stream down", () => {
  const parser = new SSEParser();
  const events = parser.push(
    encoder.encode("event: delta\ndata: {not json\n\n" + 'event: delta\ndata: {"text":"ok"}\n\n'),
  );
  assert.deepEqual(events, [{ type: "delta", text: "ok" }]);
});

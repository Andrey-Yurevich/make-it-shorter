import { toServerEvent, type ServerEvent } from "./protocol.ts";

// Our own SSE parser, because EventSource cannot do this: it only speaks GET and takes
// no headers, and we need a body, X-Device-Id and x-amz-content-sha256.
//
// Two things break parsers like this one, and neither shows up against a local mock or
// on a fast connection, where chunks happen to arrive as whole frames:
//
//   1. TextDecoder without {stream: true} turns a multi-byte character cut by a chunk
//      boundary into garbage — visible on Cyrillic, CJK and emoji and nowhere else.
//   2. A frame can be split across chunks. The network owes us no "\n\n". Hence the
//      buffer: only whole frames are taken out of it, the tail waits for more.
export class SSEParser {
  private decoder = new TextDecoder("utf-8");
  private buffer = "";

  // Feeds one network chunk and returns the events that became complete because of it.
  push(chunk: Uint8Array): ServerEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  private drain(): ServerEvent[] {
    const events: ServerEvent[] = [];
    let separator = this.buffer.indexOf("\n\n");

    while (separator !== -1) {
      const frame = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);

      const event = parseFrame(frame);
      if (event) {
        events.push(event);
      }
      separator = this.buffer.indexOf("\n\n");
    }
    return events;
  }
}

// One frame is `event: <name>\ndata: <compact JSON on one line>`. Multi-line data never
// happens — the server marshals JSON, which escapes newlines inside strings — and the
// spec lets the parser rely on that. Comment lines (": ping") are the heartbeat and are
// dropped here.
function parseFrame(frame: string): ServerEvent | null {
  let name = "";
  let data = "";

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith(":") || line === "") {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");

    if (field === "event") {
      name = value;
    } else if (field === "data") {
      data = value;
    }
  }

  if (!name || !data) {
    return null;
  }
  return toServerEvent(name, data);
}

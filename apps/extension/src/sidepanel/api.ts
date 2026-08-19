import { API_URL, REQUEST_TIMEOUT_MS } from "../shared/limits.ts";
import type { ErrorCode, ServerEvent, SummarizeRequest } from "../shared/protocol.ts";
import { SSEParser } from "../shared/sse.ts";
import { getDeviceId } from "../shared/storage.ts";

// The request is made from here, from the side panel, and not from the service worker:
// the panel is an ordinary document that lives exactly as long as it is open, and the
// stream arrives where it is drawn. Chrome unloads an idle worker mid-stream.

export type StreamHandlers = {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (code: ErrorCode, message?: string) => void;
};

export async function shorten(request: SummarizeRequest, handlers: StreamHandlers): Promise<void> {
  const body = JSON.stringify(request);

  // One absolute deadline, 60s from the start of the request to `done`. It is above the
  // function's own 50s on purpose: a client that gives up before the server answers
  // shows an error where a reply was already on its way. Whatever text has arrived
  // stays on screen — half a result beats an empty field with an error under it.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": await getDeviceId(),
        // OAC in front of the Function URL: CloudFront does not hash the body itself,
        // it signs whatever this header says. Without it the origin answers 403, and a
        // local mock will never show you that.
        "x-amz-content-sha256": await sha256Hex(body),
      },
      body,
    });

    // Anything but 200 is transport trouble, not our protocol: the WAF rejects some
    // requests with a plain 403 and no SSE in sight.
    if (!response.ok || !response.body) {
      handlers.onError("upstream_error");
      return;
    }

    await readStream(response.body, handlers);
  } catch {
    // An aborted stream lands here too — the deadline above, or the panel being closed.
    handlers.onError("upstream_error");
  } finally {
    clearTimeout(deadline);
  }
}

async function readStream(stream: ReadableStream<Uint8Array>, handlers: StreamHandlers): Promise<void> {
  const reader = stream.getReader();
  const parser = new SSEParser();
  let finished = false;

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    for (const event of parser.push(value)) {
      dispatch(event, handlers);
      finished = event.type === "done" || event.type === "error";
    }
  }

  // The stream closed without `done` and without `error`. The server always sends one of
  // them, so this is a connection that died — and the indicator has to come off
  // somehow.
  if (!finished) {
    handlers.onError("upstream_error");
  }
}

function dispatch(event: ServerEvent, handlers: StreamHandlers): void {
  switch (event.type) {
    case "delta":
      handlers.onDelta(event.text);
      return;
    case "done":
      handlers.onDone();
      return;
    case "error":
      handlers.onError(event.code, event.message);
      return;
  }
}

async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

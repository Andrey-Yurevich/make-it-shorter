// The wire types. They are written here by hand and not generated from a shared schema:
// the two sides share data, not code, and a generator would be a build dependency
// spanning Go and TypeScript for four small shapes. Compatibility is a contract test's
// job, against a real response.

export type ErrorCode =
  | "too_short"
  | "too_long"
  | "rate_limited"
  | "unsupported_language"
  | "upstream_error"
  | "invalid_request"
  | "service_disabled"
  | "nothing_to_shorten";

export const ERROR_CODES: ErrorCode[] = [
  "too_short",
  "too_long",
  "rate_limited",
  "unsupported_language",
  "upstream_error",
  "invalid_request",
  "service_disabled",
  "nothing_to_shorten",
];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as string[]).includes(value);
}

// The voice the shorter text is written in. The server validates against the same four
// ids, so a value that is not here is invalid_request. The order is the order of the
// picker, and the label and the emoji are what it shows; only the id goes on the wire.
//
// `simplified` is the default because the shortest useful answer to "make this shorter"
// is plain words and short sentences: whoever reached for this extension was having
// trouble with the text in front of them.
export const TONES = [
  { id: "simplified", label: "Simplified", emoji: "🔤" },
  { id: "professional", label: "Professional", emoji: "💼" },
  { id: "casual", label: "Casual", emoji: "😊" },
  { id: "direct", label: "Direct", emoji: "🎯" },
] as const;

export type Tone = (typeof TONES)[number]["id"];

export const DEFAULT_TONE: Tone = "simplified";

export function isTone(value: unknown): value is Tone {
  return typeof value === "string" && TONES.some((tone) => tone.id === value);
}

export type Source = "selection" | "page" | "manual";

export type ShortenRequest = {
  text: string;
  lang: string;
  tone: Tone;
  source: Source;
};

// The order is fixed: delta* → done. `done` always arrives on the normal path —
// without it the client cannot tell "finished" from a dropped connection.
export type ServerEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; code: ErrorCode; message?: string };

// Turns one parsed SSE frame into an event, or null if it is none of ours. Unknown
// event names and malformed payloads are dropped silently — the standard says to
// ignore what you do not know, and there is nobody to report it to.
export function toServerEvent(name: string, data: string): ServerEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const fields = payload as Record<string, unknown>;

  switch (name) {
    case "delta":
      return typeof fields.text === "string" ? { type: "delta", text: fields.text } : null;
    case "done":
      // {tokensIn, tokensOut} is server bookkeeping. Showing it to the user is
      // forbidden, and the panel must not break when the fields are absent.
      return { type: "done" };
    case "error":
      return isErrorCode(fields.code)
        ? {
            type: "error",
            code: fields.code,
            message: typeof fields.message === "string" ? fields.message : undefined,
          }
        : null;
    default:
      return null;
  }
}

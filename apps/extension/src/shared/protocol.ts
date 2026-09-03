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
  | "service_disabled";

export const ERROR_CODES: ErrorCode[] = [
  "too_short",
  "too_long",
  "rate_limited",
  "unsupported_language",
  "upstream_error",
  "invalid_request",
  "service_disabled",
];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as string[]).includes(value);
}

// The voice the summary is written in. `original` keeps the register of the source; every
// other value is a register to write in whatever the source sounds like. The server
// validates against the same list, so a value that is not here is invalid_request.
export const TONES = [
  "original",
  "diplomatic",
  "formal",
  "professional",
  "confident",
  "friendly",
  "academic",
  "casual",
  "simplified",
  "bold",
  "empathetic",
  "direct",
  "luxury",
  "persuasive",
  "engaging",
] as const;

export type Tone = (typeof TONES)[number];

export function isTone(value: unknown): value is Tone {
  return typeof value === "string" && (TONES as readonly string[]).includes(value);
}

export type Source = "selection" | "page" | "manual";

export type SummarizeRequest = {
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

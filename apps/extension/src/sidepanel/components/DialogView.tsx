import { useState } from "react";
import { t } from "../../shared/i18n.ts";
import type { ErrorCode } from "../../shared/protocol.ts";
import { Button } from "./ui.tsx";
import type { RunState } from "../state.ts";

// One dialog: source, summary, buttons, expansions. Everything below the summary is
// already on the device — pressing a button never goes to the network.
export function DialogView({
  state,
  labels,
  onRetry,
}: {
  state: RunState;
  labels: Record<string, string>;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);

  if (state.unreadablePage) {
    return <Notice title={t("unreadableTitle")} body={t("unreadableBody")} />;
  }
  if (!state.dialog) {
    return <Notice title={t("emptyTitle")} body={t("emptyBody")} />;
  }

  const { dialog } = state;
  const waitingForFirstDelta = state.streaming && dialog.summary === "";

  function toggle(id: string): void {
    setExpanded((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <SourceLine text={dialog.sourceText} truncated={dialog.truncated} />

      {waitingForFirstDelta ? (
        <Skeleton />
      ) : (
        <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">{dialog.summary}</p>
      )}

      {/* Buttons show up under the summary while their texts are still being written.
          A disabled button means the expansion is on its way: the label is readable,
          the press does nothing. */}
      {dialog.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dialog.actions.map((action) => {
            const label = labels[action.id];
            // An id with no label is skipped without a word. There is nobody to read a
            // log line about it.
            if (!label) {
              return null;
            }
            return (
              <Button
                key={action.id}
                variant="outline"
                disabled={action.text === ""}
                aria-expanded={expanded.includes(action.id)}
                onClick={() => toggle(action.id)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      )}

      {dialog.actions
        .filter((action) => expanded.includes(action.id) && action.text !== "")
        .map((action) => (
          <section key={action.id} className="rounded-lg bg-surface-muted px-3 py-2">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              {labels[action.id]}
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{action.text}</p>
          </section>
        ))}

      {state.streaming && <Indicator />}
      {state.error && <ErrorNotice error={state.error} onRetry={onRetry} />}
    </div>
  );
}

function SourceLine({ text, truncated }: { text: string; truncated: boolean }) {
  return (
    <div className="text-xs text-ink-soft">
      <details>
        <summary className="cursor-pointer select-none">{t("sourceLabel")}</summary>
        <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-surface-muted p-2">
          {text}
        </p>
      </details>
      {truncated && <p className="mt-1 italic">{t("sourceTruncated")}</p>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="h-3 w-full animate-pulse rounded bg-surface-muted" />
      <div className="h-3 w-11/12 animate-pulse rounded bg-surface-muted" />
      <div className="h-3 w-8/12 animate-pulse rounded bg-surface-muted" />
    </div>
  );
}

// Comes off on `done` or `error`, and on nothing else.
function Indicator() {
  return <p className="text-xs text-ink-soft">{t("working")}</p>;
}

function ErrorNotice({
  error,
  onRetry,
}: {
  error: { code: ErrorCode; message?: string };
  onRetry: () => void;
}) {
  // `message` only ever arrives with service_disabled: hand-written English, shown as
  // is. Every other code carries no text and the wording comes from _locales.
  const text = error.message ?? t(messageKey(error.code));
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface-muted px-3 py-2">
      <p className="text-sm text-ink">{text}</p>
      {error.code !== "rate_limited" && (
        <Button variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}

function messageKey(code: ErrorCode): string {
  switch (code) {
    case "too_short":
      return "errorTooShort";
    case "too_long":
      return "errorTooLong";
    case "rate_limited":
      return "errorRateLimited";
    case "unsupported_language":
      return "errorUnsupportedLanguage";
    case "invalid_request":
      return "errorInvalidRequest";
    case "service_disabled":
      return "errorServiceDisabled";
    case "upstream_error":
      return "errorUpstream";
  }
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-8 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="text-sm text-ink-soft">{body}</p>
    </div>
  );
}

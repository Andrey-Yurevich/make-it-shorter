import { useState } from "react";
import { t } from "../../shared/i18n.ts";
import { MIN_INPUT } from "../../shared/limits.ts";
import { countCodePoints, normalizeText } from "../../shared/text.ts";
import { Button, SendIcon } from "./ui.tsx";

// Manual input. The only check before sending is the length after normalisation, and it
// is here to keep an obviously unusable request off the wire — the server decides. Text
// longer than the ceiling is cut rather than refused, so the only thing that can block
// the button is text that is too short.
export function Composer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string, truncated: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const tooShort = countCodePoints(value.trim()) < MIN_INPUT;

  function submit(): void {
    const normalized = normalizeText(value);
    if (disabled || countCodePoints(normalized.text) < MIN_INPUT) {
      return;
    }
    setValue("");
    onSubmit(normalized.text, normalized.truncated);
  }

  return (
    <div className="flex items-end gap-2 border-t border-line px-3 py-2">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder={t("composerPlaceholder")}
        className="max-h-40 min-h-[2.5rem] flex-1 resize-y rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:border-ink/40"
      />
      <Button
        onClick={submit}
        disabled={disabled || tooShort}
        title={tooShort ? t("composerTooShort") : t("composerSend")}
        aria-label={t("composerSend")}
      >
        <SendIcon />
      </Button>
    </div>
  );
}

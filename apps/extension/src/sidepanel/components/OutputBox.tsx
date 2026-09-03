import { useEffect, useRef, useState } from "react";
import { cn } from "./ui.tsx";

// The result, and the one thing anybody does with a result: copy it. The field is
// read-only rather than disabled — read-only text can still be selected, scrolled and
// copied by hand, which is what a disabled field takes away.
export function OutputBox({ text, streaming }: { text: string; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  // Follow the text as it is written. Without this the newest sentence is below the
  // fold on anything longer than the field, and the panel looks stuck after the first
  // few lines.
  useEffect(() => {
    if (streaming && field.current) {
      field.current.scrollTop = field.current.scrollHeight;
    }
  }, [text, streaming]);

  // The confirmation replaces the offer for a moment and then goes back. There is
  // nowhere else in the panel to put it.
  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative flex min-h-32 flex-1 flex-col">
      <textarea
        id="shortened-text"
        ref={field}
        readOnly
        value={text}
        className="h-full w-full flex-1 resize-none rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm leading-relaxed text-ink focus:outline-none"
      />
      {text !== "" && (
        <button
          type="button"
          onClick={() => void copy()}
          className={cn(
            "absolute end-2 top-2 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink shadow-sm",
            // Out of the way until the user goes for the text, and always there for the
            // keyboard.
            "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

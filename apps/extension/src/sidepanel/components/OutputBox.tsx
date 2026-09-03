import { useEffect, useRef, useState } from "react";
import { Skeleton, cn } from "./ui.tsx";

// The result, and the one thing anybody does with a result: copy it. The field is
// read-only rather than disabled — read-only text can still be selected, scrolled and
// copied by hand, which is what a disabled field takes away.
//
// Three looks, in the order a run goes through them: a skeleton while nothing has
// arrived yet, the text being written, and the finished text with Copy on hover.
export function OutputBox({ text, streaming }: { text: string; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  const waitingForFirstToken = streaming && text === "";
  const finished = !streaming && text !== "";

  // Follow the text as it is written. Without this the newest sentence is below the
  // fold on anything longer than the field, and the panel looks stuck after the first
  // few lines.
  useEffect(() => {
    if (streaming && field.current) {
      field.current.scrollTop = field.current.scrollHeight;
    }
  }, [text, streaming]);

  // A new run means a new text, and "Copied" was about the old one.
  useEffect(() => {
    if (streaming) {
      setCopied(false);
    }
  }, [streaming]);

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

      {/* Where the first lines will be, until they are. The wait for the page to be
          read and the wait for the first token are one wait to the user, and this is
          what both of them look like. */}
      {waitingForFirstToken && (
        <div className="pointer-events-none absolute inset-x-3 top-2 flex max-w-xs flex-col gap-2 pt-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}

      {/* Only once the text is complete: copying half an answer is not what anybody
          means by Copy, and a cover over text that is still moving looks broken.

          The whole field is the button. Hovering anywhere over the result brings up a
          translucent cover with the label in the middle, and a click anywhere copies.
          The wheel is passed down to the field so that a long result still scrolls
          under the cover. */}
      {finished && (
        <button
          type="button"
          onClick={() => void copy()}
          onWheel={(event) => {
            if (field.current) {
              field.current.scrollTop += event.deltaY;
            }
          }}
          aria-label={copied ? "Copied" : "Copy the shortened text"}
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-lg bg-surface/60",
            "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <span className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm">
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
      )}
    </div>
  );
}

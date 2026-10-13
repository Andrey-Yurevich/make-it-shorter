import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/CopyButton.tsx";
import { MarkdownView } from "@/components/MarkdownView.tsx";
import { Button } from "@/components/ui/button";
import {
  clearOutputWindowContent,
  readOutputWindowContent,
  watchOutputWindowContent,
  type OutputWindowContent,
} from "@/shared/storage.ts";

// The result in a window of its own: read it, copy it, close it. The text arrives
// through chrome.storage.session — memory, never disk.
//
// The window may be opened while the panel is still writing, and then it goes on
// writing here: the panel puts every version of the text under the same key and this
// reads them as they come. The key is removed as soon as a finished version has
// arrived. What the window holds when the panel stops is what it keeps — a new run in
// the panel does not reach a window that was already handed its text.
export function App() {
  const [content, setContent] = useState<OutputWindowContent | null | undefined>(undefined);
  const renderedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;

    function show(next: OutputWindowContent | null): void {
      if (!alive) {
        return;
      }
      setContent(next);
      if (next && !next.streaming) {
        void clearOutputWindowContent();
      }
    }

    void readOutputWindowContent().then(show);
    const stopWatching = watchOutputWindowContent(show);

    return () => {
      alive = false;
      stopWatching();
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-base leading-relaxed">
        {content === undefined ? null : content === null ? (
          <p className="text-muted-foreground">Nothing to show.</p>
        ) : (
          <div ref={renderedRef}>
            <MarkdownView
              markdown={content.markdown}
              lang={content.lang}
              images={content.images}
              streaming={content.streaming}
            />
          </div>
        )}
      </main>
      <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
        {/* Copy stays live while the text is still arriving, unlike the panel's: the
            panel knows the run is going to end, and this window does not. Closing the
            panel mid-run leaves the text here half-written, and half a text that can be
            copied beats a button that will never come back. */}
        {content && <CopyButton markdown={content.markdown} rendered={renderedRef} variant="outline" />}
        <Button variant="outline" size="sm" onClick={() => window.close()}>
          Close
        </Button>
      </div>
    </div>
  );
}

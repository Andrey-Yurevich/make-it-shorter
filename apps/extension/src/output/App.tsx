import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/CopyButton.tsx";
import { MarkdownView } from "@/components/MarkdownView.tsx";
import { Button } from "@/components/ui/button";
import { takeOutputWindowContent, type OutputWindowContent } from "@/shared/storage.ts";

// The result in a window of its own: read it, copy it, close it. The text arrives
// through chrome.storage.session — memory, never disk — and the key is removed as soon
// as it is read. The window is static: a new run in the panel does not update it.
export function App() {
  const [content, setContent] = useState<OutputWindowContent | null | undefined>(undefined);
  const renderedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void takeOutputWindowContent().then(setContent);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-base leading-relaxed">
        {content === undefined ? null : content === null ? (
          <p className="text-muted-foreground">Nothing to show.</p>
        ) : (
          <div ref={renderedRef}>
            <MarkdownView markdown={content.markdown} lang={content.lang} />
          </div>
        )}
      </main>
      <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
        {content && <CopyButton markdown={content.markdown} rendered={renderedRef} variant="outline" />}
        <Button variant="outline" size="sm" onClick={() => window.close()}>
          Close
        </Button>
      </div>
    </div>
  );
}

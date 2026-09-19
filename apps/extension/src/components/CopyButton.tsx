import { useEffect, useState, type ComponentProps, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { markdownToPlainText } from "@/shared/markdown.ts";

// Copy puts two flavours on the clipboard: the plain text for editors and chat boxes,
// and the rendered HTML — the innerHTML of the container the caller points at — for
// documents and mail that keep formatting. The button is a word, not an icon, and it
// reads "Copied" for a moment afterwards.

type Props = Pick<ComponentProps<typeof Button>, "variant" | "size" | "className"> & {
  markdown: string;
  // The rendered result; its innerHTML is the text/html half of the clipboard item.
  rendered: RefObject<HTMLElement | null>;
};

const COPIED_FOR_MS = 1500;

export function CopyButton({ markdown, rendered, variant = "ghost", size = "sm", className }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    const plain = markdownToPlainText(markdown);
    const html = rendered.current?.innerHTML ?? "";
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plain], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
    } catch {
      // The clipboard refused the rich item (an older Chrome, or focus elsewhere). The
      // plain text alone is still worth having.
      await navigator.clipboard.writeText(plain).catch(() => {});
    }
    setCopied(true);
  }

  return (
    <Button variant={variant} size={size} className={className} onClick={() => void copy()}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

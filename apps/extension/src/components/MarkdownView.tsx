import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isRtl } from "@/shared/lang.ts";
import type { ExtractedImage } from "@/shared/messaging.ts";

// The result, rendered. The model is told to write minimal Markdown — prose, lists, a
// table if the source had one, a bold line as a heading — and this renders exactly that
// set: p, strong, em, ul, ol, li, table, thead, tbody, tr, th, td, br. Whatever else it
// produces is folded into that set rather than shown as markup or hidden: a heading is a
// bold paragraph, a link is its text, a code block is a paragraph. Raw HTML is not
// rendered (react-markdown's default shows it as text).
//
// Images are the one thing that does not come from the model. `markdown` has been
// through hydrate(), which turned the extraction's "{{img:N}}" markers into "![](N)",
// and `images` is the table those numbers index. Nothing else renders as a picture: an
// address the model wrote by itself is not a number and is not in the table.
//
// Shared between the side panel and the output window, so the two look the same.

type Props = {
  // Hydrated: see shared/hydrate.ts. The caller hydrates rather than this component, so
  // that the character counter and Copy read exactly the text that is on screen.
  markdown: string;
  lang: string;
  images?: ExtractedImage[];
  className?: string;
};

// Stable identities: a fresh array or set on every render would restart the effect below
// on every render.
const NO_IMAGES: ExtractedImage[] = [];
const NONE_FAILED: ReadonlySet<number> = new Set();

export function MarkdownView({ markdown, lang, images = NO_IMAGES, className }: Props) {
  // Pictures that would not load. They are not retried and not marked: see `picture`.
  const [failed, setFailed] = useState(NONE_FAILED);

  // A different table is a different run, and its pictures deserve their own attempt.
  useEffect(() => setFailed(NONE_FAILED), [images]);

  const table = useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);
  const withPictures = useMemo<Components>(
    () => ({
      ...components,
      img: picture(table, failed, (id) => setFailed((gone) => new Set(gone).add(id))),
    }),
    [table, failed],
  );

  return (
    <div dir={isRtl(lang) ? "rtl" : undefined} className={className}>
      <Markdown remarkPlugins={[remarkGfm]} components={withPictures}>
        {markdown}
      </Markdown>
    </div>
  );
}

// The picture a number stands for. A number with nothing behind it renders as nothing,
// and so does one that failed to load: no broken-image icon, no caption, no gap. A
// picture behind a login, past an expired signature or guarded against hotlinking just
// is not there, and a row of grey icons would say less about the text than the text does.
function picture(
  table: Map<number, ExtractedImage>,
  failed: ReadonlySet<number>,
  onFail: (id: number) => void,
): Components["img"] {
  return ({ src }) => {
    const id = Number(src);
    const image = table.get(id);
    if (!image || failed.has(id)) {
      return null;
    }
    return (
      <img
        src={image.src}
        alt={image.alt}
        loading="lazy"
        decoding="async"
        // Two things at once: the host never learns the extension's id, and the hotlink
        // guards that turn away a foreign Referer usually let an empty one through.
        referrerPolicy="no-referrer"
        onError={() => onFail(id)}
        className="my-2 block max-h-64 max-w-full rounded object-contain"
      />
    );
  };
}

// Headings of any level: a paragraph in bold.
function Heading({ children }: { children?: ReactNode }) {
  return (
    <p className="my-2 first:mt-0 last:mb-0">
      <strong>{children}</strong>
    </p>
  );
}

function Paragraph({ children }: { children?: ReactNode }) {
  return <p className="my-2 first:mt-0 last:mb-0">{children}</p>;
}

// Only the children: the wrapper disappears and its text stays.
function Unwrap({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

// react-markdown hands every component a `node` prop with the syntax tree behind it.
// It is not a DOM attribute, so it is dropped before anything is spread onto one.
function dom<T extends keyof HTMLElementTagNameMap>(
  tag: T,
  className: string,
): (props: ComponentProps<T> & { node?: unknown }) => ReactNode {
  const Tag = tag as unknown as (props: ComponentProps<T>) => ReactNode;
  return ({ node: _node, ...props }) => <Tag {...(props as ComponentProps<T>)} className={className} />;
}

const components: Components = {
  p: Paragraph,
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
  ul: dom("ul", "my-2 list-disc ps-5 first:mt-0 last:mb-0"),
  ol: dom("ol", "my-2 list-decimal ps-5 first:mt-0 last:mb-0"),
  li: dom("li", "my-0.5"),
  table: dom("table", "my-2 w-full border-collapse text-start first:mt-0 last:mb-0"),
  th: dom("th", "border px-2 py-1 text-start font-medium"),
  td: dom("td", "border px-2 py-1 align-top"),
  a: Unwrap,
  em: dom("em", ""),
  strong: dom("strong", "font-semibold"),
  del: Unwrap,
  code: Unwrap,
  pre: Paragraph,
  blockquote: Unwrap,
  hr: () => null,
  input: () => null,
  sup: Unwrap,
  section: Unwrap,
};

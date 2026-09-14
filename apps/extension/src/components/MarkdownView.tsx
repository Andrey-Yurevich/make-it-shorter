import type { ComponentProps, ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isRtl } from "@/shared/lang.ts";

// The result, rendered. The model is told to write minimal Markdown — prose, lists, a
// table if the source had one, a bold line as a heading — and this renders exactly that
// set: p, strong, em, ul, ol, li, table, thead, tbody, tr, th, td, br. Whatever else it
// produces is folded into that set rather than shown as markup or hidden: a heading is a
// bold paragraph, a link is its text, a code block is a paragraph. Raw HTML is not
// rendered (react-markdown's default shows it as text).
//
// Shared between the side panel and the output window, so the two look the same.

type Props = {
  markdown: string;
  lang: string;
  className?: string;
};

export function MarkdownView({ markdown, lang, className }: Props) {
  return (
    <div dir={isRtl(lang) ? "rtl" : undefined} className={className}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </div>
  );
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
  img: ({ alt }) => <>{alt}</>,
  input: () => null,
  sup: Unwrap,
  section: Unwrap,
};

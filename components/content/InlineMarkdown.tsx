"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const remarkPlugins = [[remarkGfm, { singleTilde: false }]] satisfies NonNullable<Parameters<typeof ReactMarkdown>[0]["remarkPlugins"]>;
const allowedElements = ["p", "strong", "em", "del", "code", "br"];
const components: Components = {
  p: ({ children }) => <>{children}</>,
  code: ({ children }) => <code className="markdown-inline-code">{children}</code>,
};

/** Formatting inside compact labels, including labels nested in buttons. */
export function InlineMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <span className={["markdown-inline", className].filter(Boolean).join(" ")}>
      <ReactMarkdown remarkPlugins={remarkPlugins} allowedElements={allowedElements} unwrapDisallowed skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </span>
  );
}

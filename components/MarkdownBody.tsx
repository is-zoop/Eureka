"use client";

import { memo, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { advanceStreamReveal, rehypeStreamReveal } from "@/lib/stream-reveal";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

function StreamCharacter({ children, bornAt, delay }: { children: ReactNode; bornAt: number; delay: number }) {
  // Keep an existing animation's clock stable; remounts catch up instead of replaying.
  const [initialDelay] = useState(() => delay - Math.max(0, Date.now() - bornAt));
  return <span className="stream-reveal-character" style={{ animationDelay: `${initialDelay}ms` }}>{children}</span>;
}

export const MarkdownBody = memo(function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  const [reveal, setReveal] = useState(() => advanceStreamReveal(null, normalizedMarkdown, Boolean(isStreaming)));
  if (reveal.source !== normalizedMarkdown || reveal.streaming !== Boolean(isStreaming)) {
    setReveal(advanceStreamReveal(reveal, normalizedMarkdown, Boolean(isStreaming)));
  }
  const rehypePlugins = useMemo<NonNullable<Options["rehypePlugins"]>>(() => reveal.characters.length
    ? [...(markdownRehypePlugins ?? []), [rehypeStreamReveal, reveal]]
    : markdownRehypePlugins ?? [], [reveal]);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    span({ node, children, ...props }) {
      const bornAt = node?.properties.dataStreamBornAt;
      const delay = node?.properties.dataStreamDelay;
      if (typeof bornAt === "number" && typeof delay === "number") {
        return <StreamCharacter key={`${bornAt}:${node?.properties.dataStreamOffset}`} bornAt={bornAt} delay={delay}>{children}</StreamCharacter>;
      }
      return <span {...props}>{children}</span>;
    },
    code({ className, children, ...props }) {
      // Parser metadata belongs to the renderer, not to the DOM element.
      delete props.node;
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={isStreaming} />;
      }
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <a href={href} {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a href={href} {...props} onClick={handleClick}>
          {children}
        </a>
      );
    },
    img({ src, alt, ...props }) {
      delete props.node;
      const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
      const imageSrc = filePath
        ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
        : src;
      // Dynamic local paths are served directly by the file API.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table className="markdown-table">{children}</table>
        </div>
      );
    },
  }), [cwd, isStreaming, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")} data-streaming={Boolean(isStreaming)}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
});

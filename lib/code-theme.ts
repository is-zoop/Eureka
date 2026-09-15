import { vs } from "react-syntax-highlighter/dist/esm/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

// Shared Prism palette for chat code blocks and the file-source viewer.
// CSS variables keep token colors aligned with the active application theme.
export const editorLightTheme = {
  ...vs,
  "code[class*='language-']": { ...vs["code[class*='language-']"], color: "var(--text)", background: "transparent", fontFamily: "var(--font-code-mono)" },
  "pre[class*='language-']": { ...vs["pre[class*='language-']"], color: "var(--text)", background: "transparent", border: "none", fontFamily: "var(--font-code-mono)" },
  comment: { ...vs.comment, color: "var(--text-muted)", fontStyle: "italic" },
  keyword: { ...vs.keyword, color: "var(--accent)" },
  string: { ...vs.string, color: "var(--code-string)" },
  number: { ...vs.number, color: "var(--code-string)" },
  boolean: { ...vs.boolean, color: "var(--code-string)" },
  function: { ...vs.function, color: "var(--text)", fontWeight: 600 },
  "class-name": { ...vs["class-name"], color: "var(--accent)" },
  property: { ...vs.property, color: "var(--text)" },
  tag: { ...vs.tag, color: "var(--accent)" },
  "attr-name": { ...vs["attr-name"], color: "var(--text)" },
  "attr-value": { ...vs["attr-value"], color: "var(--code-string)" },
  punctuation: { ...vs.punctuation, color: "var(--text-muted)" },
  entity: { ...vs.entity, color: "var(--accent)" },
  selector: { ...vs.selector, color: "var(--accent)" },
  operator: { ...vs.operator, color: "var(--text-muted)" },
};

export const editorDarkTheme = {
  ...vscDarkPlus,
  "code[class*='language-']": { ...vscDarkPlus["code[class*='language-']"], color: "var(--text)", background: "transparent", fontFamily: "var(--font-code-mono)" },
  "pre[class*='language-']": { ...vscDarkPlus["pre[class*='language-']"], color: "var(--text)", background: "transparent", border: "none", fontFamily: "var(--font-code-mono)" },
  comment: { ...vscDarkPlus.comment, color: "var(--text-muted)", fontStyle: "italic" },
  keyword: { ...vscDarkPlus.keyword, color: "var(--accent)" },
  string: { ...vscDarkPlus.string, color: "var(--code-string)" },
  number: { ...vscDarkPlus.number, color: "var(--code-string)" },
  boolean: { ...vscDarkPlus.boolean, color: "var(--code-string)" },
  function: { ...vscDarkPlus.function, color: "var(--text)", fontWeight: 600 },
  "class-name": { ...vscDarkPlus["class-name"], color: "var(--accent)" },
  property: { ...vscDarkPlus.property, color: "var(--text)" },
  tag: { ...vscDarkPlus.tag, color: "var(--accent)" },
  "attr-name": { ...vscDarkPlus["attr-name"], color: "var(--text)" },
  "attr-value": { ...vscDarkPlus["attr-value"], color: "var(--code-string)" },
  punctuation: { ...vscDarkPlus.punctuation, color: "var(--text-muted)" },
  entity: { ...vscDarkPlus.entity, color: "var(--accent)" },
  selector: { ...vscDarkPlus.selector, color: "var(--accent)" },
  operator: { ...vscDarkPlus.operator, color: "var(--text-muted)" },
};

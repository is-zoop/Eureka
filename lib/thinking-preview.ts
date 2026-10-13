/** A bounded display excerpt, without loading or changing the full reasoning text. */
export function getThinkingPreview(thinking: string): string {
  const plain = thinking.slice(0, 4096)
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^(?:\s{0,3}#{1,6}\s+|\s*>\s*|\s*[-+*]\s+|\s*\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__)([\s\S]*?)\1/g, "$2")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/^\s*(?:\*\*|__|`+)/gm, "")
    .replace(/\s+/g, " ").trim();
  const chars = Array.from(plain);
  return chars.length > 160 ? chars.slice(0, 160).join("") + "…" : plain;
}

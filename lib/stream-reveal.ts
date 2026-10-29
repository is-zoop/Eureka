import type { Element, Root, RootContent, Text } from "hast";

export const STREAM_REVEAL_DURATION = 120;
export const STREAM_REVEAL_STAGGER = 30;
const MAX_DELAY = 90;
const MAX_CHARACTERS = 24;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

interface RevealCharacter {
  offset: number;
  bornAt: number;
  delay: number;
}

export interface StreamRevealState {
  source: string;
  streaming: boolean;
  characters: RevealCharacter[];
}

/** Existing snapshots and rewritten Markdown are immediately readable. */
export function advanceStreamReveal(
  previous: StreamRevealState | null,
  source: string,
  streaming: boolean,
  now: number = Date.now(),
): StreamRevealState {
  if (!streaming || !previous?.streaming || !source.startsWith(previous.source)) {
    return { source, streaming, characters: [] };
  }
  const characters = previous.characters.filter((character) => (
    now < character.bornAt + character.delay + STREAM_REVEAL_DURATION
  ));
  // Bound both segmentation work and animated DOM even for a large snapshot.
  const start = Math.max(previous.source.length, source.length - 256);
  const added = [...segmenter.segment(source.slice(start))].slice(-MAX_CHARACTERS);
  added.forEach(({ index }, order) => characters.push({
    offset: start + index,
    bornAt: now,
    delay: Math.min(order * STREAM_REVEAL_STAGGER, MAX_DELAY),
  }));
  return { source, streaming, characters: characters.slice(-MAX_CHARACTERS) };
}

const excludedTags = new Set(["code", "pre", "table", "svg", "math", "script", "style", "textarea"]);

/** Runs after sanitization/KaTeX, so animation never changes Markdown syntax. */
export function rehypeStreamReveal(state: StreamRevealState) {
  const characters = new Map(state.characters.map((character) => [character.offset, character]));
  const firstOffset = state.characters[0]?.offset ?? Infinity;
  const lastOffset = state.characters.at(-1)?.offset ?? -Infinity;
  return (tree: Root) => {
    if (!characters.size) return;
    function decorateText(node: Text): RootContent[] {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined || end <= firstOffset || start > lastOffset) return [node];
      // Escapes/entities and generated formula text do not have a 1:1 source map.
      if (state.source.slice(start, end) !== node.value) return [node];
      const result: RootContent[] = [];
      let plainStart = 0;
      for (const { segment, index } of segmenter.segment(node.value)) {
        const character = characters.get(start + index);
        if (!character || !segment.trim()) continue;
        if (index > plainStart) result.push({ type: "text", value: node.value.slice(plainStart, index) });
        result.push({
          type: "element", tagName: "span",
          properties: { dataStreamBornAt: character.bornAt, dataStreamDelay: character.delay, dataStreamOffset: character.offset },
          children: [{ type: "text", value: segment }],
        });
        plainStart = index + segment.length;
      }
      if (plainStart < node.value.length) result.push({ type: "text", value: node.value.slice(plainStart) });
      return result;
    }
    function visit(parent: Root | Element) {
      if (parent.type === "element") {
        const classes = parent.properties.className;
        if (excludedTags.has(parent.tagName) || (Array.isArray(classes) && classes.some((name) => /katex|math/.test(String(name))))) return;
      }
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if (node.type === "text") return decorateText(node);
        if (node.type === "element") visit(node);
        return [node];
      }) as typeof parent.children;
    }
    visit(tree);
  };
}

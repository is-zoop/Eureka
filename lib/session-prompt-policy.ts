import type { InlineExtension } from "@earendil-works/pi-coding-agent";

declare global {
  var __eurekaSuppressedSessionPrompts: WeakSet<object> | undefined;
}

const suppressed = globalThis.__eurekaSuppressedSessionPrompts ??= new WeakSet<object>();

export function setSessionPromptSuppressed(manager: object, value: boolean): void {
  if (value) suppressed.add(manager);
  else suppressed.delete(manager);
}

export function isSessionPromptSuppressed(manager: object): boolean {
  return suppressed.has(manager);
}

/** Apply host permission policy after the other extensions prepare this run. */
export const EUREKA_PROMPT_POLICY_EXTENSION: InlineExtension = {
  name: "eureka-prompt-policy",
  hidden: true,
  factory: (pi) => {
    pi.on("before_agent_start", (_event, ctx) => {
      if (!suppressed.has(ctx.sessionManager)) return;
      pi.setActiveTools([]);
      return { systemPrompt: "" };
    });
  },
};

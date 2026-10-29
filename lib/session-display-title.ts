import { splitPluginSelection } from "./plugin-selection";
import { skillExpansionToCommand } from "./slash-display";

/** Extract user-facing title text without changing the stored message or name. */
export function sessionTitleText(raw: string): string {
  let text = splitPluginSelection(raw).text.trim();
  // Titles and previews can contain a flattened or truncated envelope, which
  // the strict message parser deliberately leaves untouched.
  const pluginStart = text.indexOf("<eureka-selected-plugins");
  if (pluginStart >= 0) text = text.slice(0, pluginStart).trim();

  const command = skillExpansionToCommand(text);
  if (command !== null) {
    text = command;
  } else if (/^<skill\s+name="[^"\r\n]+"\s+location="[^"\r\n]+">/.test(text)) {
    // A flattened preview may no longer match the SDK's multiline envelope.
    // Keep only arguments after the final closing tag, never the skill body.
    const end = text.lastIndexOf("</skill>");
    text = end >= 0 ? text.slice(end + "</skill>".length) : "";
  }

  return text.replace(/^\/skill:[^\s]+(?:\s+|$)/u, "").replace(/\s+/gu, " ").trim();
}

export function getSessionDisplayTitle(
  session: { name?: string; firstMessage?: string } | null,
  fallback: string,
  maxFallbackLength?: number,
): string {
  const name = sessionTitleText(session?.name ?? "");
  if (name) return name;
  const firstMessage = sessionTitleText(session?.firstMessage ?? "");
  return (maxFallbackLength === undefined ? firstMessage : firstMessage.slice(0, maxFallbackLength)) || fallback;
}

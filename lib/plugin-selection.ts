/** Public identity only. No paths, credentials or executable input from the client. */
export interface SelectedPlugin { source: string; capabilityId: string; digest: string; name: string; selectionMode?: "once" | "persistent"; subject?: string }
export interface ComposerPlugin extends SelectedPlugin { description: string; skills: string[]; state: string }
export function dedupePlugins(items: SelectedPlugin[]): SelectedPlugin[] {
  return [...new Map(items.map((item) => [`${item.source}\0${item.capabilityId}`, { ...item }])).values()];
}
export function retainedPluginSelection(items: SelectedPlugin[]): SelectedPlugin[] {
  return dedupePlugins(items.filter((item) => item.selectionMode === "persistent"));
}
const PREFIX = "\n\n<eureka-selected-plugins>";
export function selectionEnvelope(text: string, plugins: SelectedPlugin[], context = ""): string {
  if (!plugins.length) return text;
  return `${text}${PREFIX}${JSON.stringify({ plugins, context })}</eureka-selected-plugins>`;
}
export function splitPluginSelection(text: string): { text: string; plugins: SelectedPlugin[]; context: string } {
  const at = text.lastIndexOf(PREFIX);
  if (at < 0 || !text.endsWith("</eureka-selected-plugins>")) return { text, plugins: [], context: "" };
  try {
    const value = JSON.parse(text.slice(at + PREFIX.length, -"</eureka-selected-plugins>".length));
    if (!Array.isArray(value.plugins) || value.plugins.length > 20 || value.plugins.some((p: SelectedPlugin) => !p || [p.source, p.capabilityId, p.digest, p.name].some((v) => typeof v !== "string"))) throw new Error();
    return { text: text.slice(0, at), plugins: value.plugins, context: typeof value.context === "string" ? value.context : "" };
  } catch { return { text, plugins: [], context: "" }; }
}

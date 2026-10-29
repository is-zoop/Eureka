export function versionNotes(changelog: string | string[] | null) {
  const values = Array.isArray(changelog) ? changelog : changelog?.split(/\r?\n/) ?? [];
  return values.map((value) => value.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

export function rewriteDocumentImages(markdown: string, capabilityId: string, basePath: string) {
  const base = basePath.replace(/^\/+|\/+$/g, "");
  return markdown.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+[^)]*)?\)/g, (source, alt: string, src: string) => {
    if (/^(?:https?:|data:|blob:|\/)/i.test(src)) return source;
    const parts = `${base}/${src}`.split("/").filter((part) => part && part !== ".");
    const normalized: string[] = [];
    for (const part of parts) { if (part === "..") normalized.pop(); else normalized.push(part); }
    return `![${alt}](/api/organization-extensions/${encodeURIComponent(capabilityId)}/documentation/${normalized.map(encodeURIComponent).join("/")})`;
  });
}


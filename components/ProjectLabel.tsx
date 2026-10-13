import { getFileName } from "@/lib/file-paths";

export function ProjectLabel({ path, displayPath = path }: { path: string; displayPath?: string }) {
  return (
    <span title={path} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, whiteSpace: "nowrap", lineHeight: 1.35 }}>
      <span style={{ flex: "0 1 auto", minWidth: 0, maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text)" }}>
        {getFileName(path) || path}
      </span>
      <span style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, color: "var(--text-muted)", direction: "rtl", textAlign: "left" }}>
        <span style={{ unicodeBidi: "plaintext" }}>{displayPath}</span>
      </span>
    </span>
  );
}

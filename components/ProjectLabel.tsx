import { getFileName } from "@/lib/file-paths";
import { LabelTooltip } from "./LabelTooltip";

export function ProjectLabel({ path, displayPath = path }: { path: string; displayPath?: string }) {
  return (
    <LabelTooltip content={path}>
      <span style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 8, flex: 1, minWidth: 0, whiteSpace: "nowrap", lineHeight: "20px" }}>
        <span style={{ flex: "0 1 auto", minWidth: 0, maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text)", fontWeight: 400 }}>
          {getFileName(path) || path}
        </span>
        <span style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, lineHeight: "16px", color: "var(--text-dim)", direction: "rtl", textAlign: "left" }}>
          <span style={{ unicodeBidi: "plaintext" }}>{displayPath}</span>
        </span>
      </span>
    </LabelTooltip>
  );
}

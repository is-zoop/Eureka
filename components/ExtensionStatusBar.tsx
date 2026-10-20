"use client";

import { parseAnsiLine, stripAnsi } from "@/lib/ansi";
import { useI18n } from "@/hooks/useI18n";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { ExtensionWidgets } from "./ExtensionWidgets";
import { McpStatusPopover } from "./McpStatusPopover";

function localizeMcpStatusText(text: string, t: ReturnType<typeof useI18n>["t"]): string {
  return text
    .replace(/(\d+) servers? enabled\b/g, (_, count: string) => t(count === "1" ? "mcpStatus.footer.enabledOne" : "mcpStatus.footer.enabledMany", { count }))
    .replace(/(\d+) connected\b/g, (_, count: string) => t("mcpStatus.footer.connected", { count }))
    .replace(/(\d+) disabled\b/g, (_, count: string) => t("mcpStatus.footer.disabled", { count }))
    .replace(/connecting to (\d+) servers\.\.\./g, (_, count: string) => t("mcpStatus.footer.connectingServers", { count }))
    .replace(/connecting to (.+?)\.\.\./g, (_, server: string) => t("mcpStatus.footer.connectingServer", { server }));
}

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

export function ExtensionStatusBar({
  statuses,
  widgets = [],
  sessionId,
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
  sessionId?: string | null;
}) {
  const { t } = useI18n();
  if (statuses.length === 0 && widgets.length === 0) return null;

  const displayStatuses = statuses.map((status) => status.key === "mcp" ? { ...status, text: localizeMcpStatusText(status.text, t) } : status);
  const statusLine = formatExtensionStatusLine(displayStatuses);
  const plainStatusLine = stripAnsi(statusLine);

  return (
    <div
      className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${statuses.length > 0 ? " has-status" : ""}`}
    >
      {widgets.length > 0 && <ExtensionWidgets widgets={widgets} />}
      {statuses.length > 0 && (
        <div
          role="status"
          className="extension-status-line"
          aria-label={plainStatusLine}
          title={plainStatusLine}
        >
          <span className="extension-status-text">
            {[...displayStatuses].sort((a, b) => a.key.localeCompare(b.key)).map((status, index) => {
              const text = sanitizeExtensionStatusText(status.text) + (index < statuses.length - 1 ? " " : "");
              const content = parseAnsiLine(text).map((segment, segmentIndex) => <span key={segmentIndex} style={segment.style}>{segment.text}</span>);
              return status.key === "mcp"
                ? <span key={`${status.key}:${sessionId ?? ""}`}><McpStatusPopover sessionId={sessionId}>{parseAnsiLine(sanitizeExtensionStatusText(status.text)).map((segment, segmentIndex) => <span key={segmentIndex} style={segment.style}>{segment.text}</span>)}</McpStatusPopover>{index < statuses.length - 1 ? " " : null}</span>
                : <span key={status.key}>{content}</span>;
            })}
          </span>
        </div>
      )}
    </div>
  );
}

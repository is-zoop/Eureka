"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

export function SettingsSelect({ label, value, options, onValueChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger aria-label={label} style={{ display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: 140, maxWidth: "100%", minHeight: 32, flexShrink: 0, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{options.find((option) => option.value === value)?.label ?? value}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-muted)" }}><path d="m6 9 6 6 6-6" /></svg>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" style={{ minWidth: 140, width: "max-content", background: "var(--bg-panel)", color: "var(--text)", border: "1px solid var(--border)" }}>
      <DropdownMenuRadioGroup value={value} onValueChange={(next) => { if (options.some((option) => option.value === next)) onValueChange(next); }}>
        {options.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value} indicatorPosition="start" className="focus:bg-[var(--bg-hover)] focus:text-[var(--text)] focus:**:text-[var(--text)]" style={({ highlighted }) => ({ padding: "7px 10px 7px 30px", background: highlighted ? "var(--bg-hover)" : "transparent", color: "var(--text)", fontSize: 12 })}>{option.label}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

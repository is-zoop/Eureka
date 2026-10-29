"use client";

import { useI18n } from "@/hooks/useI18n";
import { capabilityTypeLabelKey } from "@/lib/organization-capability";

export function CapabilityTypeBadge({ type, className = "" }: {
  type: "Skill" | "MCP" | "Plugin";
  className?: string;
}) {
  const { t } = useI18n();
  return <span data-capability-type={type} className={`capability-type-badge inline-flex rounded-md px-1.5 py-0.5 text-xs font-semibold ${className}`}>{t(capabilityTypeLabelKey(type))}</span>;
}

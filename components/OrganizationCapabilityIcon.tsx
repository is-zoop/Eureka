"use client";

import { useState } from "react";
import { CpuIcon, LayersIcon, PlugIcon } from "lucide-react";
import { organizationCapabilityIconUrl, type OrganizationCapabilityRef } from "@/lib/organization-capability";

export function OrganizationCapabilityIcon({ capability, size = 20, iconUrl, type = "Plugin", fit = "contain", className = "" }: {
  capability: OrganizationCapabilityRef;
  size?: number;
  iconUrl?: string | null;
  type?: "Plugin" | "Skill" | "MCP";
  fit?: "contain" | "cover";
  className?: string;
}) {
  const url = iconUrl === undefined ? organizationCapabilityIconUrl(capability) : iconUrl;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const FallbackIcon = type === "MCP" ? CpuIcon : type === "Plugin" ? PlugIcon : LayersIcon;
  // Authenticated icon responses must use the browser cookie directly.
  /* eslint-disable @next/next/no-img-element */
  return <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${size >= 28 ? "rounded-[var(--radius-control)]" : "rounded"} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
    {url && failedUrl !== url
      ? <img src={url} alt="" className={`block h-full w-full rounded-[inherit] ${fit === "cover" ? "object-cover" : "object-contain"}`} onError={() => setFailedUrl(url)} />
      : <FallbackIcon width={Math.min(size, 20)} height={Math.min(size, 20)} />}
  </span>;
}

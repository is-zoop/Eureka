"use client";

import { useState } from "react";
import { CpuIcon, LayersIcon } from "lucide-react";
import { organizationCapabilityIconUrl, type OrganizationCapabilityRef } from "@/lib/organization-capability";

export function OrganizationCapabilityIcon({ capability, size = 20, iconUrl, type = "Plugin", className = "" }: {
  capability: OrganizationCapabilityRef;
  size?: number;
  iconUrl?: string | null;
  type?: "Plugin" | "Skill" | "MCP";
  className?: string;
}) {
  const url = iconUrl === undefined ? organizationCapabilityIconUrl(capability) : iconUrl;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const FallbackIcon = type === "MCP" ? CpuIcon : LayersIcon;
  // Authenticated icon responses must use the browser cookie directly.
  /* eslint-disable @next/next/no-img-element */
  return <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded ${className}`} style={{ width: size, height: size }} aria-hidden="true">
    {url && failedUrl !== url
      ? <img src={url} alt="" className="h-full w-full object-contain" onError={() => setFailedUrl(url)} />
      : <FallbackIcon width={Math.min(size, 20)} height={Math.min(size, 20)} />}
  </span>;
}

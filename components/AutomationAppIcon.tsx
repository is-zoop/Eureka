"use client";
import Image from "next/image";
import { useState } from "react";
import { WorkflowIcon } from "lucide-react";
import type { AutomationAppIndex, AutomationAppInstall } from "@/lib/automation-app";
import { OrganizationCapabilityIcon } from "./OrganizationCapabilityIcon";
import { cn } from "@/lib/utils";

export function AutomationAppIcon({ app, identity, size = 18, className }: {
  app: Pick<AutomationAppInstall, "id" | "managedPlugin" | "presentation">;
  identity?: Pick<AutomationAppIndex, "ownerKey" | "runtimeId">; size?: number; className?: string;
}) {
  const [failed, setFailed] = useState("");
  if (app.managedPlugin) return <OrganizationCapabilityIcon capability={app.managedPlugin} size={size} fit="contain" className={cn("rounded-[2px]!", className)} />;
  const source = app.presentation?.icon && identity ? `/api/automation/apps/${encodeURIComponent(app.id)}/icon?${new URLSearchParams({ ownerKey: identity.ownerKey, runtimeId: identity.runtimeId, v: app.presentation.icon.digest })}` : "";
  return <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[2px]", className)} style={{ width: size, height: size }}>
    {source && failed !== source ? <Image src={source} alt="" width={size} height={size} unoptimized className="h-full w-full object-contain" onError={() => setFailed(source)} /> : <WorkflowIcon size={Math.min(size, 22)} strokeWidth={1.6} />}
  </span>;
}

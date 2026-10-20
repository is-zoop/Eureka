import { pluginPresentation } from "@/lib/haze-plugin-resources";
import { getAuthConfig } from "@/lib/auth/config";
import { readRuntimeHazeSession } from "@/lib/auth/runtime-session";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { listHazeManagedInstalls, type HazeCapabilityType, type HazeInstallScope } from "@/lib/haze-managed-capabilities";

export const dynamic = "force-dynamic";

function scope(value: string | null): HazeInstallScope | null {
  return value === "global" || value === "project" ? value : null;
}

function type(value: string | null): HazeCapabilityType | null {
  return value === "skill" ? "Skill" : value === "mcp" ? "MCP" : value === "plugin" ? "Plugin" : null;
}

/** Lists only presentation-safe managed-install data. Secrets and local paths stay server-side. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cwd = searchParams.get("cwd");
  const selectedScope = scope(searchParams.get("scope"));
  const selectedType = type(searchParams.get("type"));
  if (!cwd || !selectedScope || !selectedType) return NextResponse.json({ error: "cwd, scope, and type are required" }, { status: 400 });
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  try {
    const installs = await listHazeManagedInstalls(cwd);
    return NextResponse.json({
      items: installs[selectedScope]
        .filter((item) => item.type === selectedType && (item.type !== "Plugin" || item.plugin?.source === getAuthConfig()?.issuer.replace(/\/$/, "")))
        .map((item) => ({ capabilityId: item.capabilityId, name: item.name, type: item.type, version: item.version, scope: item.scope, installedAt: item.installedAt, disabled: Boolean(item.disabled), ...(item.type === "MCP" ? { lifecycle: item.lifecycle, idleTimeout: item.idleTimeout } : {}), ...(item.type === "Plugin" ? { plugin: pluginPresentation(item, searchParams.get("sessionId"), readRuntimeHazeSession()?.principal.subject ?? null) } : {}) })),
    });
  } catch {
    return NextResponse.json({ error: "Unable to read installed capabilities" }, { status: 500 });
  }
}

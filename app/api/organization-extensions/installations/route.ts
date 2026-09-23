import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { listHazeManagedInstalls, type HazeCapabilityType, type HazeInstallScope } from "@/lib/haze-managed-capabilities";

export const dynamic = "force-dynamic";

function scope(value: string | null): HazeInstallScope | null {
  return value === "global" || value === "project" ? value : null;
}

function type(value: string | null): HazeCapabilityType | null {
  return value === "skill" ? "Skill" : value === "mcp" ? "MCP" : null;
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
        .filter((item) => item.type === selectedType)
        .map(({ capabilityId, name, type: capabilityType, version, scope: installScope, installedAt, disabled, lifecycle, idleTimeout }) => ({ capabilityId, name, type: capabilityType, version, scope: installScope, installedAt, disabled: Boolean(disabled), ...(capabilityType === "MCP" ? { lifecycle, idleTimeout } : {}) })),
    });
  } catch {
    return NextResponse.json({ error: "Unable to read installed capabilities" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getHazeMarketplaceSession, listOrganizationExtensions, OrganizationExtensionsError, type OrganizationExtensionType } from "@/lib/organization-extensions";
import { configureHazeManagedMcp, hazeMcpRuntimeOptions, installHazeCapability, listHazeManagedInstalls, setHazeCapabilityDisabled, uninstallHazeCapability, type HazeCapabilityType, type HazeInstallScope } from "@/lib/haze-managed-capabilities";

function validId(value: string) { return /^\d+$/.test(value); }
function scope(value: unknown): HazeInstallScope { return value === "global" ? "global" : "project"; }
function type(value: unknown): HazeCapabilityType | null { return value === "Skill" || value === "MCP" ? value : null; }

async function assertCwd(cwd: unknown) {
  if (typeof cwd !== "string" || !cwd) throw new Error("cwd required");
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) throw new Error("Access denied");
  return cwd;
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message === "Access denied" ? 403 : message === "cwd required" ? 400 : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!validId(id)) return NextResponse.json({ error: "invalid capability id" }, { status: 400 });
    const cwd = await assertCwd(new URL(request.url).searchParams.get("cwd"));
    const installs = await listHazeManagedInstalls(cwd);
    return NextResponse.json({
      global: installs.global.filter((item) => item.capabilityId === id),
      project: installs.project.filter((item) => item.capabilityId === id),
    });
  } catch (error) { return responseError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  const { id } = await context.params;
  try {
    if (!validId(id)) return NextResponse.json({ error: "invalid capability id" }, { status: 400 });
    const body = await request.json() as { cwd?: unknown; scope?: unknown; action?: unknown; type?: unknown; disabled?: unknown; lifecycle?: unknown; idleTimeout?: unknown };
    const cwd = await assertCwd(body.cwd);
    const installScope = scope(body.scope);
    const capabilityType = type(body.type);
    if (!capabilityType) return NextResponse.json({ error: "invalid capability type" }, { status: 400 });
    if (body.action === "update" && capabilityType === "MCP") return NextResponse.json({ error: "HTTP MCP does not support update" }, { status: 400 });
    if ((body.action === "install" || body.action === "update") && installScope === "project" && !getProjectTrustStatus(cwd, getAgentDir()).trusted) return NextResponse.json({ error: "Project resources must be trusted before installing project capabilities" }, { status: 403 });
    if (body.action === "uninstall") {
      await uninstallHazeCapability(cwd, installScope, id, capabilityType);
    } else if (body.action === "set-disabled") {
      if (typeof body.disabled !== "boolean") return NextResponse.json({ error: "invalid disabled action" }, { status: 400 });
      await setHazeCapabilityDisabled(cwd, installScope, id, capabilityType, body.disabled);
    } else if (body.action === "configure") {
      if (capabilityType !== "MCP") return NextResponse.json({ error: "Only MCP supports runtime configuration" }, { status: 400 });
      await configureHazeManagedMcp(cwd, installScope, id, hazeMcpRuntimeOptions(body.lifecycle, body.idleTimeout));
    } else if (body.action === "install" || body.action === "update") {
      const { accessToken } = await getHazeMarketplaceSession();
      const remoteType: OrganizationExtensionType = capabilityType === "Skill" ? "skill" : "mcp";
      const remote = (await listOrganizationExtensions(remoteType, accessToken)).find((item) => item.id === id);
      if (!remote) return NextResponse.json({ error: "Capability not found or unavailable" }, { status: 404 });
      const runtime = capabilityType === "MCP" ? hazeMcpRuntimeOptions(body.lifecycle ?? "lazy", body.idleTimeout ?? 10) : undefined;
      await installHazeCapability(cwd, installScope, { id: remote.id, name: remote.name, slug: remote.slug, type: remote.type, version: remote.version, serverUrl: remote.serverUrl, connectType: remote.connectType }, runtime, accessToken);
    } else return NextResponse.json({ error: "invalid action" }, { status: 400 });
    const installs = await listHazeManagedInstalls(cwd);
    return NextResponse.json({ global: installs.global.filter((item) => item.capabilityId === id), project: installs.project.filter((item) => item.capabilityId === id) });
  } catch (error) {
    if (error instanceof OrganizationExtensionsError) return NextResponse.json({ error: error.kind }, { status: error.kind === "unauthenticated" ? 401 : error.kind === "forbidden" ? 403 : 502 });
    return responseError(error);
  }
}

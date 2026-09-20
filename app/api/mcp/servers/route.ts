import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { listMcpServers, mutateMcpServers } from "@/lib/mcp-config";
import { listHazeManagedInstalls } from "@/lib/haze-managed-capabilities";
import type { McpConfigScope, McpServerInput } from "@/lib/api-types";

export const dynamic = "force-dynamic";
const scope = (value: string | null | undefined): McpConfigScope => value === "global" ? "global" : "project";

async function allowed(cwd: string) { return isExistingFilePathAllowed(cwd, await getAllowedFileRoots()); }

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url); const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  if (!await allowed(cwd)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  try {
    const selectedScope = scope(searchParams.get("scope"));
    const [config, managed] = await Promise.all([listMcpServers(cwd, selectedScope), listHazeManagedInstalls(cwd)]);
    return NextResponse.json({
      ...config,
      managedServers: managed[selectedScope]
        .filter((item) => item.type === "MCP" && typeof item.serverUrl === "string")
        .map((item) => ({ capabilityId: item.capabilityId, name: item.name, version: item.version, scope: selectedScope, serverUrl: item.serverUrl!, disabled: Boolean(item.disabled) })),
    });
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await request.json() as { cwd?: string; scope?: McpConfigScope; action?: "create" | "update" | "delete" | "set-disabled"; server?: McpServerInput; previousName?: string; disabled?: boolean };
    if (!body.cwd || !body.action) return NextResponse.json({ error: "cwd and action required" }, { status: 400 });
    if (!await allowed(body.cwd)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    return NextResponse.json(await mutateMcpServers(body.cwd, scope(body.scope), body.action, body.server, body.previousName, body.disabled));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}

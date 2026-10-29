import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { uninstallMarketSkill } from "@/lib/skill-uninstall";
import { samePath } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await request.json() as { cwd?: unknown; scope?: unknown; package?: unknown; filePath?: unknown };
    if (!body || typeof body !== "object" || typeof body.cwd !== "string" || !body.cwd || typeof body.package !== "string" || !body.package || typeof body.filePath !== "string" || !body.filePath || body.scope !== "project" && body.scope !== "global") {
      return NextResponse.json({ error: "cwd, package, scope, and filePath are required" }, { status: 400 });
    }
    const { cwd, scope, package: pkg, filePath } = body;
    if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    const inventory = await loadSkillsWithInstallInfo(cwd);
    const skill = (inventory.installedSkills ?? inventory.skills).find(item => item.install?.package === pkg && item.install.scope === scope && samePath(item.filePath, filePath));
    if (!skill) return NextResponse.json({ error: "Installed skill not found" }, { status: 404 });
    if (skill.managedPlugin || skill.organizationCapability) return NextResponse.json({ error: "This skill cannot be uninstalled here" }, { status: 409 });
    await uninstallMarketSkill(skill, { cwd, scope, agentDir: getAgentDir() });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

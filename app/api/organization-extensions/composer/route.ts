import { NextResponse } from "next/server";
import { readAuthSession } from "@/lib/auth/session";
import { getAuthConfig } from "@/lib/auth/config";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { listComposerPlugins } from "@/lib/composer-plugins";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await readAuthSession();
  if (!auth) return NextResponse.json({ error: "请先登录 Haze" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const cwd = query.get("cwd");
  if (!cwd || !isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  return NextResponse.json({ plugins: listComposerPlugins(cwd, getAuthConfig()!.issuer.replace(/\/$/, ""), auth.principal.subject, query.get("sessionId") ?? undefined) });
}

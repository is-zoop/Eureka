import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { getGitRepositoryRoot, getGitWorkspace, GitOperationError, mutateGit } from "@/lib/git-operations";
import type { GitMutation } from "@/lib/git-types";
import { hasJsonContentType } from "@/lib/request-security";

async function authorizedRepository(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    throw new GitOperationError("invalidCwd", "cwd must be an absolute path.");
  }
  const roots = await getAllowedFileRoots();
  const allowed = (target: string) => isFilePathAllowed(target, roots) && isExistingFilePathAllowed(target, roots);
  if (!allowed(cwd)) throw new GitOperationError("denied", "Access denied.", 403);
  const repositoryRoot = await getGitRepositoryRoot(cwd);
  // A permitted subdirectory must not grant write access to its parent repository.
  if (!allowed(repositoryRoot)) throw new GitOperationError("denied", "Access denied.", 403);
  return repositoryRoot;
}

function failure(error: unknown) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : String(error),
    code: error instanceof GitOperationError ? error.code : "gitFailed",
  }, { status: error instanceof GitOperationError ? error.status : 500 });
}

export async function GET(request: NextRequest) {
  try {
    const repositoryRoot = await authorizedRepository(request.nextUrl.searchParams.get("cwd"));
    return NextResponse.json(await getGitWorkspace(repositoryRoot), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    if (!hasJsonContentType(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
    const body = await request.json().catch(() => null);
    if (!body || !["stage", "unstage", "discard", "ignore", "commit", "push"].includes(body.action)
      || typeof body.revision !== "string" || (body.stageAllIfEmpty !== undefined && typeof body.stageAllIfEmpty !== "boolean")) {
      throw new GitOperationError("invalidAction", "Invalid Git operation.");
    }
    const repositoryRoot = await authorizedRepository(body.cwd);
    return NextResponse.json(await mutateGit(repositoryRoot, body as GitMutation));
  } catch (error) { return failure(error); }
}

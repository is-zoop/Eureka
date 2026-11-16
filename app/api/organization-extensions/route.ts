import { NextRequest, NextResponse } from "next/server";
import { getHazeMarketplaceSession, cachedOrganizationExtensions, OrganizationExtensionsError, type OrganizationExtensionType } from "@/lib/organization-extensions";
import { writeAuthSession } from "@/lib/auth/session";

function errorResponse(error: OrganizationExtensionsError) {
  const status = error.kind === "unauthenticated" ? 401 : error.kind === "forbidden" ? 403 : 502;
  return NextResponse.json({ error: error.kind }, { status });
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");
  if (type !== "skill" && type !== "mcp" && type !== "plugin") return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  try {
    const { accessToken, session } = await getHazeMarketplaceSession();
    const items = await cachedOrganizationExtensions(type as OrganizationExtensionType, accessToken, request.nextUrl.searchParams.get("force") === "1");
    const response = NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
    await writeAuthSession(response.cookies, session);
    return response;
  } catch (error) {
    return errorResponse(error instanceof OrganizationExtensionsError ? error : new OrganizationExtensionsError("unavailable"));
  }
}

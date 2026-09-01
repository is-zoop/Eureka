import { NextRequest, NextResponse } from "next/server";
import { getHazeMarketplaceSession, listOrganizationExtensions, OrganizationExtensionsError, type OrganizationExtensionType } from "@/lib/organization-extensions";
import { writeAuthSession } from "@/lib/auth/session";

function errorResponse(error: OrganizationExtensionsError) {
  const status = error.kind === "unauthenticated" ? 401 : error.kind === "forbidden" ? 403 : 502;
  return NextResponse.json({ error: error.kind }, { status });
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");
  if (type !== "skill" && type !== "mcp") return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  try {
    const { accessToken, session } = await getHazeMarketplaceSession();
    const items = await listOrganizationExtensions(type as OrganizationExtensionType, accessToken);
    const response = NextResponse.json({ items });
    writeAuthSession(response.cookies, session);
    return response;
  } catch (error) {
    return errorResponse(error instanceof OrganizationExtensionsError ? error : new OrganizationExtensionsError("unavailable"));
  }
}

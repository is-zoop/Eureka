import { NextResponse } from "next/server";
import { getHazeMarketplaceSession, listOrganizationExtensionCategories, OrganizationExtensionsError } from "@/lib/organization-extensions";
import { writeAuthSession } from "@/lib/auth/session";

function errorResponse(error: OrganizationExtensionsError) {
  const status = error.kind === "unauthenticated" ? 401 : error.kind === "forbidden" ? 403 : 502;
  return NextResponse.json({ error: error.kind }, { status });
}

export async function GET() {
  try {
    const { accessToken, session } = await getHazeMarketplaceSession();
    const items = await listOrganizationExtensionCategories(accessToken);
    const response = NextResponse.json({ items });
    writeAuthSession(response.cookies, session);
    return response;
  } catch (error) {
    return errorResponse(error instanceof OrganizationExtensionsError ? error : new OrganizationExtensionsError("unavailable"));
  }
}

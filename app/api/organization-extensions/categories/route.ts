import { NextResponse } from "next/server";
import { getHazeMarketplaceSession, cachedOrganizationCategories, OrganizationExtensionsError } from "@/lib/organization-extensions";
import { writeAuthSession } from "@/lib/auth/session";

function errorResponse(error: OrganizationExtensionsError) {
  const status = error.kind === "unauthenticated" ? 401 : error.kind === "forbidden" ? 403 : 502;
  return NextResponse.json({ error: error.kind }, { status });
}

export async function GET(request: Request) {
  try {
    const { accessToken, session } = await getHazeMarketplaceSession();
    const items = await cachedOrganizationCategories(accessToken, new URL(request.url).searchParams.get("force") === "1");
    const response = NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
    await writeAuthSession(response.cookies, session);
    return response;
  } catch (error) {
    return errorResponse(error instanceof OrganizationExtensionsError ? error : new OrganizationExtensionsError("unavailable"));
  }
}

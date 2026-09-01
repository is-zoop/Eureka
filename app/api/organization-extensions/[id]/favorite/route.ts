import { NextResponse } from "next/server";
import { getHazeMarketplaceSession, OrganizationExtensionsError, toggleOrganizationExtensionFavorite } from "@/lib/organization-extensions";
import { writeAuthSession } from "@/lib/auth/session";

function errorResponse(error: OrganizationExtensionsError) {
  const status = error.kind === "unauthenticated" ? 401 : error.kind === "forbidden" ? 403 : 502;
  return NextResponse.json({ error: error.kind }, { status });
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { accessToken, session } = await getHazeMarketplaceSession();
    const isFavorite = await toggleOrganizationExtensionFavorite(id, accessToken);
    const response = NextResponse.json({ isFavorite });
    writeAuthSession(response.cookies, session);
    return response;
  } catch (error) {
    return errorResponse(error instanceof OrganizationExtensionsError ? error : new OrganizationExtensionsError("unavailable"));
  }
}

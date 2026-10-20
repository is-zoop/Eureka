import { NextResponse } from "next/server";
import { fetchOrganizationExtensionIcon, getHazeMarketplaceSession, OrganizationExtensionsError } from "@/lib/organization-extensions";
import { writeAuthSession } from "@/lib/auth/session";
import { getAuthConfig } from "@/lib/auth/config";

function errorResponse(error: OrganizationExtensionsError) {
  const status = error.kind === "unauthenticated" ? 401 : error.kind === "forbidden" ? 403 : 404;
  return new NextResponse(null, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const source = new URL(request.url).searchParams.get("source");
    if (source && source !== getAuthConfig()?.issuer) return new NextResponse(null, { status: 404 });
    const { id } = await params;
    const { accessToken, session } = await getHazeMarketplaceSession();
    const upstream = await fetchOrganizationExtensionIcon(id, accessToken);
    const response = new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
      },
    });
    await writeAuthSession(response.cookies, session);
    return response;
  } catch (error) {
    return errorResponse(error instanceof OrganizationExtensionsError ? error : new OrganizationExtensionsError("unavailable"));
  }
}

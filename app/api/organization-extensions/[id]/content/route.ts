import { NextRequest, NextResponse } from "next/server";
import { fetchOrganizationExtensionContent, getHazeMarketplaceSession, OrganizationExtensionsError } from "@/lib/organization-extensions";
import { writeAuthSession } from "@/lib/auth/session";

function errorResponse(error: OrganizationExtensionsError) {
  const status = error.kind === "unauthenticated" ? 401 : error.kind === "forbidden" ? 403 : 502;
  return NextResponse.json({ error: error.kind }, { status });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const file = request.nextUrl.searchParams.get("file");
  if (file !== "quick_start.md" && file !== "README.md") return NextResponse.json({ error: "invalid_file" }, { status: 400 });
  try {
    const { id } = await params;
    const { accessToken, session } = await getHazeMarketplaceSession();
    const content = await fetchOrganizationExtensionContent(id, file, accessToken);
    const response = NextResponse.json(content);
    writeAuthSession(response.cookies, session);
    return response;
  } catch (error) {
    return errorResponse(error instanceof OrganizationExtensionsError ? error : new OrganizationExtensionsError("unavailable"));
  }
}

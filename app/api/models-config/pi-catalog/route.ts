import { piCatalogStatus, refreshPiCatalog, schedulePiCatalogSync, setPiCatalogEnabled } from "@/lib/pi-catalog-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  schedulePiCatalogSync();
  return Response.json(piCatalogStatus());
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { enabled?: unknown; refresh?: unknown };
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") return Response.json({ error: "Invalid enabled value" }, { status: 400 });
      setPiCatalogEnabled(body.enabled);
    }
    if (body.refresh === true) await refreshPiCatalog(true);
    schedulePiCatalogSync();
    return Response.json(piCatalogStatus());
  } catch {
    return Response.json({ error: "Pi model catalog settings unavailable" }, { status: 500 });
  }
}

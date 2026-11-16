import { NextResponse } from "next/server";
import { generatedImageAccess, generatedImageFailure, ImageGenerationError } from "@/lib/generated-image-api";
import { getProviderModelRuntime } from "@/lib/provider-model-runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const store = generatedImageAccess(request);
    if (new URL(request.url).searchParams.has("models")) {
      const runtime = await getProviderModelRuntime(), models = await runtime.getAvailableOfType("image");
      store.check();
      return NextResponse.json({ models: models.map(m => ({ provider: m.provider, id: m.id, name: m.name })) }, { headers: { "Cache-Control": "no-store" } });
    }
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const item = store.get(id); if (!item) throw new ImageGenerationError("missing", 404);
      return NextResponse.json({ item }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ items: store.list().slice(0, 30) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return generatedImageFailure(error); }
}

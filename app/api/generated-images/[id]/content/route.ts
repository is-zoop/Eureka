import { generatedImageAccess, generatedImageFailure, ImageGenerationError } from "@/features/chat/server/generated-image-api";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const store = generatedImageAccess(request), { id } = await params;
    const record = store.get(id);
    if (!record) throw new ImageGenerationError("missing", 404);
    const bytes = store.image(record);
    store.check();
    const extension = record.mimeType === "image/jpeg" ? "jpg" : record.mimeType === "image/webp" ? "webp" : "png";
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": record.mimeType!, "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="eureka-image-${id}.${extension}"`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch (error) { return generatedImageFailure(error); }
}

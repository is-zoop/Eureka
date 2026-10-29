import { NextResponse } from "next/server";
import { MAX_ATTACHMENT_BYTES, resolveComposerAttachments, storeComposerFiles } from "@/lib/composer-attachments";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length")) > MAX_ATTACHMENT_BYTES + 1024 * 1024) return NextResponse.json({ error: "Attachments exceed 50 MB." }, { status: 413 });
      // Bound chunked bodies before multipart parsing buffers them.
      const reader = request.body?.getReader();
      if (!reader) throw new Error("No files provided.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_ATTACHMENT_BYTES + 1024 * 1024) {
          await reader.cancel();
          return NextResponse.json({ error: "Attachments exceed 50 MB." }, { status: 413 });
        }
        chunks.push(chunk.value);
      }
      const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
      const files = form.getAll("files").filter((value): value is File => typeof value !== "string");
      return NextResponse.json(await storeComposerFiles(files));
    }
    const { paths } = await request.json();
    return NextResponse.json(await resolveComposerAttachments(paths));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

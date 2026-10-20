import { browserAccess, browserError } from "@/lib/browser-access";
import { browserOwner, closeBrowser, subscribeBrowser } from "@/lib/browser-runtime";
import { readRuntimeHazeSession } from "@/lib/auth/runtime-session";
import { getAuthConfig } from "@/lib/auth/config";
import type { BrowserEvent } from "@/lib/browser-types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const { owner, sessionId } = await browserAccess(query.get("sessionId"));
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let pendingFrame: BrowserEvent | undefined;
        const send = (event: BrowserEvent) => {
          if (closed) return;
          if (event.type === "frame" && (controller.desiredSize ?? 0) <= 0) { pendingFrame = event; return; }
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { cleanup(); }
        };
        const unsubscribe = subscribeBrowser(owner, sessionId, send, query.get("frames") === "1");
        const flush = setInterval(() => { if (pendingFrame && (controller.desiredSize ?? 0) > 0) { const frame = pendingFrame; pendingFrame = undefined; send(frame); } }, 100);
        const heartbeat = setInterval(() => {
          const identity = readRuntimeHazeSession();
          if (!identity || browserOwner(getAuthConfig()!.issuer, identity.principal.subject) !== owner) {
            void closeBrowser(owner, sessionId); cleanup(); return;
          }
          if ((controller.desiredSize ?? 0) > 0) { try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { cleanup(); } }
        }, 5000);
        cleanup = () => { if (closed) return; closed = true; unsubscribe(); clearInterval(heartbeat); clearInterval(flush); pendingFrame = undefined; request.signal.removeEventListener("abort", cleanup); try { controller.close(); } catch {} };
        request.signal.addEventListener("abort", cleanup, { once: true });
        if (request.signal.aborted) cleanup();
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (error) { return Response.json({ error: browserError(error) }, { status: 403 }); }
}

import { NextResponse } from "next/server";
import { SessionManager, SettingsManager, ModelRuntime, getAgentDir, calculateContextTokens, buildSessionContext } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { buildContextDetails, estimateMessageTokens } from "@/lib/context-details";
import { contextRevision, describeLiveContext, readContextSnapshot, saveContextSnapshot } from "@/lib/context-snapshot";
import type { ContextUsage } from "@/lib/pi-types";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leafId = new URL(req.url).searchParams.get("leafId") ?? undefined;
  try {
    const rpc = getRpcSession(id);
    const live = rpc?.isAlive() ? rpc : undefined;
    const liveManager = live?.inner.sessionManager;
    const isCurrentContext = liveManager && (!leafId || leafId === liveManager.getLeafId() || (liveManager.getEntry(leafId) && contextRevision(liveManager.getBranch(leafId)) === contextRevision(liveManager.getBranch())));
    if (live && isCurrentContext) {
      const inner = live.inner;
      const details = describeLiveContext(inner, id);
      if (live.sessionFile && details.breakdown.every((part) => part.tokens !== null)) await saveContextSnapshot(live.sessionFile, contextRevision(inner.sessionManager.getBranch()), details);
      return NextResponse.json(details, { headers: { "Cache-Control": "no-store" } });
    }
    const path = live?.sessionFile || await resolveSessionPath(id);
    if (!path) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    // Reading history must not start an AgentSession or execute project extensions.
    const manager = live?.inner.sessionManager ?? SessionManager.open(path);
    if (leafId && !manager.getEntry(leafId)) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    const branch = manager.getBranch(leafId);
    const context = buildSessionContext(manager.getEntries(), leafId ?? manager.getLeafId());
    const agentDir = getAgentDir();
    const settings = SettingsManager.create(manager.getCwd(), agentDir).getCompactionSettings();
    const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
    const model = context.model ? runtime.getModel(context.model.provider, context.model.modelId) : undefined;
    const modelId = context.model ? `${context.model.provider}/${context.model.modelId}` : null;
    const snapshot = await readContextSnapshot(path, id, contextRevision(branch), modelId);
    if (snapshot && (!model || model.contextWindow === snapshot.usage.contextWindow)) {
      return NextResponse.json({
        ...snapshot, reserveTokens: settings.reserveTokens, autoCompactionEnabled: settings.enabled,
        canCompact: !leafId || leafId === manager.getLeafId(),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    let usage: ContextUsage | null = null;
    // Only usage produced after the latest compaction belongs to this context.
    const boundary = branch.findLastIndex((entry) => entry.type === "compaction");
    for (let index = branch.length - 1; index > boundary; index--) {
      const entry = branch[index];
      if (entry.type !== "message" || entry.message.role !== "assistant" || !entry.message.usage || ["error", "aborted"].includes(entry.message.stopReason)) continue;
      const tokens = calculateContextTokens(entry.message.usage);
      if (tokens > 0) {
        const trailing = branch.slice(index + 1).flatMap((item) => item.type === "message" ? [item.message] : []);
        usage = { tokens: tokens + estimateMessageTokens(trailing), contextWindow: model?.contextWindow ?? 0, percent: null, estimated: trailing.length > 0 || entry.message.provider !== context.model?.provider || entry.message.model !== context.model?.modelId };
        break;
      }
    }
    return NextResponse.json(buildContextDetails({
      sessionId: id, source: "history", model: context.model ? `${context.model.provider}/${context.model.modelId}` : undefined,
      usage, contextWindow: model?.contextWindow, messages: context.messages,
      reserveTokens: settings.reserveTokens, autoCompactionEnabled: settings.enabled,
      canCompact: !leafId || leafId === manager.getLeafId(),
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[context-usage] Unable to read context", error);
    return NextResponse.json({ error: "Unable to read context usage" }, { status: 500 });
  }
}

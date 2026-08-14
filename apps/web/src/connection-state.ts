import type { SessionSnapshot, WebError, WebUsage } from "@pi-web/protocol";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "error";
export interface ConnectionViewState { connection: ConnectionState; snapshot?: SessionSnapshot; error?: WebError; }

export function applySnapshot(state: ConnectionViewState, snapshot: SessionSnapshot): ConnectionViewState { return { ...state, connection: "connected", snapshot, error: undefined }; }
export function applyUsage(state: ConnectionViewState, usage: WebUsage, context: SessionSnapshot["context"]): ConnectionViewState { return state.snapshot ? { ...state, snapshot: { ...state.snapshot, usage: { ...state.snapshot.usage, ...usage }, context: context ? { ...state.snapshot.context, ...context } : state.snapshot.context } } : state; }
export function connectionClosed(state: ConnectionViewState): ConnectionViewState { return { ...state, connection: "reconnecting" }; }

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Listener = (waiting: boolean) => void;
interface State { sdk: boolean; host: Set<string>; listeners: Set<Listener>; waiting: boolean }
const states = new WeakMap<object, State>();
function stateFor(manager: object): State {
  let state = states.get(manager);
  if (!state) { state = { sdk: false, host: new Set(), listeners: new Set(), waiting: false }; states.set(manager, state); }
  return state;
}
function publish(state: State) {
  const waiting = state.sdk || state.host.size > 0;
  if (waiting === state.waiting) return;
  state.waiting = waiting;
  for (const listener of state.listeners) listener(waiting);
}
export function setHostUiWait(manager: object, id: string, waiting: boolean) {
  const state = stateFor(manager);
  if (waiting) state.host.add(id); else state.host.delete(id);
  publish(state);
}
export function subscribeUiWait(manager: object, listener: Listener) {
  const state = stateFor(manager); state.listeners.add(listener); listener(state.waiting);
  return () => { state.listeners.delete(listener); };
}
export function clearUiWait(manager: object) {
  const state = states.get(manager);
  if (state) { state.sdk = false; state.host.clear(); publish(state); states.delete(manager); }
}
/** SDK UI notifications are extension events, not AgentSession transcript events. */
export function installUiWaitRuntime(pi: ExtensionAPI) {
  pi.on("ui_prompt_start", (_event, ctx) => { const state = stateFor(ctx.sessionManager); state.sdk = true; publish(state); });
  pi.on("ui_prompt_end", (_event, ctx) => { const state = stateFor(ctx.sessionManager); state.sdk = false; publish(state); });
  pi.on("session_shutdown", (_event, ctx) => clearUiWait(ctx.sessionManager));
}

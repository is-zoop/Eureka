import { createJiti } from "jiti";

export const MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";

type AdapterModule = { createMcpAdapter: () => (pi: unknown) => void | Promise<void> };
let loaded: Promise<AdapterModule> | null = null;

async function adapter() {
  loaded ??= createJiti(import.meta.url, { interopDefault: true }).import("pi-mcp-adapter") as Promise<AdapterModule>;
  return loaded;
}

/** Load the adapter's TS extension source through Pi's TS-capable runtime. */
export async function installBuiltInMcpAdapter(pi: unknown) {
  const adapterModule = await adapter();
  await adapterModule.createMcpAdapter()(pi);
}

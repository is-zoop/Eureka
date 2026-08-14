import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface ServerConfig { workspace: string; host: "127.0.0.1"; port: number; }

export async function loadServerConfig(argv: string[], env = process.env): Promise<ServerConfig> {
  const index = argv.indexOf("--workspace");
  const requested = index === -1 ? env.PI_WEB_WORKSPACE : argv[index + 1];
  if (!requested) throw new Error("Workspace is required. Pass --workspace <path> or set PI_WEB_WORKSPACE.");
  const workspace = await realpath(path.resolve(requested));
  if (!(await stat(workspace)).isDirectory()) throw new Error("Workspace must be a directory.");
  const port = Number.parseInt(env.PI_WEB_PORT ?? "3001", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PI_WEB_PORT must be a valid TCP port.");
  return { workspace, host: "127.0.0.1", port };
}

import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { samePath } from "./paths";
import { appJsonValue, type AppFileGrant, type AppJson } from "./automation-app-run";
import type { AppBrowserBinding } from "./automation-app-browser";
import contract from "./automation-sdk-contract.json";

export interface AppCheckpoint {
  schemaVersion: 1; appId: string; version: string; digest: string; actionId: string;
  paramsHash: string; inputs: string; bindings: AppBrowserBinding[];
  credentials: Record<string, string>;
  aiSettingsHash?: string;
  key: string; state: AppJson; savedAt: string; unsafe: boolean; claimedBy?: string;
}
export function checkpointHash(value: unknown): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sorted(child)])) : value;
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}
/** Read-only source metadata and selected root identities. Output directory contents may grow. */
export async function checkpointInputs(grants: AppFileGrant[], check: () => void) {
  const entries: unknown[] = []; let count = 0;
  async function visit(path: string, recursive: boolean) {
    check(); if (++count > 10000) throw new Error("检查点输入超过 10000 个文件或目录，请缩小选择范围。");
    const info = await lstat(path); if (info.isSymbolicLink() || !samePath(await realpath(path), path)) throw new Error("检查点输入含链接或路径已变化。");
    entries.push([path, info.dev, info.ino, info.isFile() ? info.size : null, info.isFile() ? info.mtimeMs : null]);
    if (recursive && info.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(join(path, name), true);
  }
  for (const grant of [...grants].sort((a, b) => a.id.localeCompare(b.id))) await visit(grant.path, grant.kind === "directory" && grant.access === "read");
  return checkpointHash(entries);
}
export function checkpointState(key: unknown, state: unknown) {
  if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(key)) throw new Error("检查点名称需要 1～120 位字母、数字、点、下划线或连字符。");
  return { key, state: appJsonValue(state, contract.limits.checkpointBytes) };
}
export function assertCheckpointCompatible(value: AppCheckpoint, expected: Pick<AppCheckpoint, "appId" | "version" | "digest" | "actionId" | "paramsHash" | "inputs">) {
  if (value.schemaVersion !== 1 || value.unsafe || value.claimedBy || Object.entries(expected).some(([key, item]) => value[key as keyof AppCheckpoint] !== item)) throw new Error("检查点已使用、存在未记录写入，或版本、参数、输入文件已变化，不能恢复。");
}

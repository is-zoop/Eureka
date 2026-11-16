import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { isAppId } from "./automation-app";
import { AutomationAppError } from "./automation-app-package";
import type { PublicationRecord } from "./automation-publication";

/** Publication state is private per Haze identity, outside application code and runtime data. */
export class PublicationStore {
  readonly directory: string;
  readonly file: string;
  constructor(base: string, ownerKey: string, readonly appId: string, readonly issuer: string, readonly subject: string, private check: () => void) {
    if (!/^[a-f0-9]{64}$/.test(ownerKey) || !isAppId(appId)) throw new AutomationAppError("发布记录身份无效", 400);
    this.directory = join(base, "eureka-publications", ownerKey, appId);
    this.file = join(this.directory, "publication.json");
  }
  async locked<T>(work: () => Promise<T>, options: { wait?: boolean } = {}): Promise<T> {
    this.check(); await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let compromised = false;
    let release: () => Promise<void>;
    try { release = await lockfile.lock(this.directory, { realpath: false, stale: 30000, update: 5000,
      retries: options.wait ? { retries: 80, factor: 1, minTimeout: 500, maxTimeout: 500 } : 0,
      onCompromised: () => { compromised = true; } }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOCKED") throw new AutomationAppError("此应用正在处理发布操作，请稍后刷新", 409);
      throw new AutomationAppError("无法访问发布记录，请检查本机目录权限", 500);
    }
    const original = this.check;
    this.check = () => { original(); if (compromised) throw new AutomationAppError("发布记录占用已失效，请刷新", 409); };
    try { this.check(); return await work(); } finally { this.check = original; await release().catch(() => {}); }
  }
  async read(): Promise<PublicationRecord | null> {
    this.check();
    let source: string;
    try { source = await readFile(this.file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    if (Buffer.byteLength(source) > 8 * 1024 * 1024) throw new AutomationAppError("发布记录大小异常", 409);
    const record = JSON.parse(source) as PublicationRecord;
    if (record.schemaVersion !== 1 || record.issuer !== this.issuer || record.subject !== this.subject || record.appId !== this.appId || !record.draft) throw new AutomationAppError("发布记录身份不一致", 409);
    this.check(); return record;
  }
  async write(record: PublicationRecord) {
    this.check();
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(record), { flag: "wx", mode: 0o600 });
      this.check(); await rename(temporary, this.file);
    } finally { await rm(temporary, { force: true }); }
  }
}

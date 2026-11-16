import { Readable, Transform, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw, crc32 } from "node:zlib";
import type { ZipEntry } from "./haze-plugin-package";
import { open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pluginRelativePath, type ZipLimits } from "./haze-plugin-package";

/** Read only ZIP metadata; compressed and expanded file bodies stay off the heap. */
export async function readZipFileEntries(path: string, limits: ZipLimits, check: () => void): Promise<ZipEntry[]> {
  const file = await open(path, "r");
  const bad = (): never => { throw new Error("ZIP 目录、路径、类型或大小校验失败。"); };
  try {
    const info = await file.stat(); if (!info.isFile() || info.size > (limits.archive ?? 16 * 1024 * 1024) || info.size < 22) bad();
    const read = async (offset: number, length: number) => { check(); if (offset < 0 || offset + length > info.size) bad(); const data = Buffer.alloc(length); let at = 0; while (at < length) { const n = (await file.read(data, at, length - at, offset + at)).bytesRead; if (!n) bad(); at += n; check(); } return data; };
    const tail = await read(Math.max(0, info.size - 65557), Math.min(info.size, 65557)), end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
    if (end < 0 || end + 22 > tail.length || end + 22 + tail.readUInt16LE(end + 20) !== tail.length) bad();
    const count = tail.readUInt16LE(end + 10), central = tail.readUInt32LE(end + 16), length = tail.readUInt32LE(end + 12);
    if (!count || count > (limits.entries ?? 512) || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count || central + length !== info.size - tail.length + end || length > 8 * 1024 * 1024) bad();
    const directory = await read(central, length), entries: ZipEntry[] = [], names = new Set<string>(); let cursor = 0, expanded = 0;
    const decode = (data: Buffer, flags: number) => { const encoding = flags & 0x800 ? "utf-8" : limits.nameEncoding ?? "auto"; if (encoding !== "auto") return new TextDecoder(encoding, { fatal: true }).decode(data); try { return new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { return new TextDecoder("gb18030", { fatal: true }).decode(data); } };
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > length || directory.readUInt32LE(cursor) !== 0x02014b50) bad();
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10), crc = directory.readUInt32LE(cursor + 16), packed = directory.readUInt32LE(cursor + 20), size = directory.readUInt32LE(cursor + 24), n = directory.readUInt16LE(cursor + 28), extra = directory.readUInt16LE(cursor + 30), comment = directory.readUInt16LE(cursor + 32), mode = directory.readUInt32LE(cursor + 38) >>> 16, local = directory.readUInt32LE(cursor + 42);
      if (cursor + 46 + n + extra + comment > length || flags & 1 || ![0, 8].includes(method) || (mode & 0xf000) && ![0x8000, 0x4000].includes(mode & 0xf000) || size > (limits.file ?? 512 * 1024 * 1024)) bad();
      const raw = decode(directory.subarray(cursor + 46, cursor + 46 + n), flags), name = pluginRelativePath(raw), key = name.toLowerCase();
      if (names.has(key)) bad(); names.add(key); expanded += size; if (expanded > (limits.expanded ?? 1024 * 1024 * 1024)) bad();
      cursor += 46 + n + extra + comment;
      if (local + 30 > central) bad(); const header = await read(local, 30), localNameSize = header.readUInt16LE(26), start = local + 30 + localNameSize + header.readUInt16LE(28);
      if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(6) !== flags || header.readUInt16LE(8) !== method || start + packed > central || decode(await read(local + 30, localNameSize), flags) !== raw) bad();
      if (raw.endsWith("/")) { if (size) bad(); } else entries.push({ name, size, crc, packed, start, method });
    }
    if (cursor !== length) bad();
    const files = new Set(entries.map(entry => entry.name.toLowerCase()));
    for (const entry of entries) { const parts = entry.name.toLowerCase().split("/"); for (let i = 1; i < parts.length; i++) if (files.has(parts.slice(0, i).join("/"))) bad(); }
    return entries;
  } finally { await file.close(); }
}

export async function readZipArchive(path:string,limit:number,check:()=>void){
  const handle=await open(path,"r");
  try{
    const info=await handle.stat();
    if(!info.isFile()||info.size>limit)throw new Error(`ZIP 输入不是普通文件或超过 ${limit/1024/1024} MiB。`);
    const buffer=Buffer.alloc(info.size+1);let length=0;
    while(length<buffer.length){check();const chunk=await handle.read(buffer,length,Math.min(64*1024,buffer.length-length),length);if(!chunk.bytesRead)break;length+=chunk.bytesRead;}
    check();if(length!==info.size)throw new Error("ZIP 在读取期间发生变化，请保存完成后重试。");
    return buffer.subarray(0,length);
  }finally{await handle.close();}
}

/** Only compressed bytes are buffered. Expanded bytes pass through in bounded chunks. */
export async function writeZipEntry(archive:Buffer|string,entry:ZipEntry,destination:Writable,check:()=>void){
  let size=0,checksum=0;
  const verify=new Transform({transform(chunk:Buffer,_encoding,done){
    try{check();size+=chunk.length;if(size>entry.size)throw new Error("ZIP 实际解压大小超过声明，未保存文件。");checksum=crc32(chunk,checksum);done(null,chunk);}catch(error){done(error as Error);}
  }});
  const source=typeof archive === "string" ? entry.packed ? createReadStream(archive,{start:entry.start,end:entry.start+entry.packed-1,highWaterMark:65536}) : Readable.from([]) : Readable.from([archive.subarray(entry.start,entry.start+entry.packed)]);
  if(entry.method===8)await pipeline(source,createInflateRaw({chunkSize:64*1024}),verify,destination);
  else await pipeline(source,verify,destination);
  check();
  if(size!==entry.size||checksum!==entry.crc)throw new Error("ZIP 内容校验失败，未保存文件。");
  return size;
}

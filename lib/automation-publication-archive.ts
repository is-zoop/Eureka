import { crc32 } from "node:zlib";
import type { PublicationDraft } from "./automation-publication";

/** Exactly two public documents; never traverses a user directory. */
export function publicationDocumentationZip(draft: Pick<PublicationDraft, "readme" | "quickStart">): Buffer {
  const files = [["README.md", draft.readme], ["quick_start.md", draft.quickStart]];
  const chunks: Buffer[] = [], indices: Buffer[] = []; let offset = 0;
  for (const [path, text] of files) {
    const name = Buffer.from(path), data = Buffer.from(text), crc = crc32(data);
    const local = Buffer.alloc(30), index = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    index.writeUInt32LE(0x02014b50); index.writeUInt16LE(0x0314, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x800, 8); index.writeUInt32LE(crc, 16); index.writeUInt32LE(data.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(name.length, 28); index.writeUInt32LE((0x81a4 * 65536) >>> 0, 38); index.writeUInt32LE(offset, 42);
    chunks.push(local, name, data); indices.push(index, name); offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(indices), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}

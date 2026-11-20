import { crc32, deflateRawSync } from "node:zlib";

export function pluginFiles(options = {}) {
  const name = "atlas-ask", version = options.version ?? "2.1.0";
  return {
    "plugin.json": JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name, version, extensions: { "com.eureka": { schemaVersion: 1, displayName: "Atlas数据助手", ...(options.composer !== undefined ? { composer: options.composer } : {}), ...(options.requestUserInput !== undefined ? { capabilities: { requestUserInput: options.requestUserInput } } : {}), auth: { atlas: { provider: "haze-personal-credential" } } } } }),
    "package.json": JSON.stringify({ name, version, pi: { skills: ["./skills"] } }),
    "mcp.json": JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: { atlas: { type: "streamable-http", url: options.url ?? "https://atlas.example/api/mcp" } } }),
    "skills/atlas-ask/SKILL.md": "---\nname: atlas-ask\ndescription: Query Atlas business data.\n---\nRead ../../references/current-rules.md.\n",
    "skills/atlas-menu/SKILL.md": "---\nname: atlas-menu\ndescription: Select data for the current Atlas session.\n---\nUse open_selection_menu.\n",
    "references/current-rules.md": "Use the current business session and verified results.\n",
    "assets/atlas.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
  };
}
export function fixtureZip(files = pluginFiles(), options = {}) {
  let offset = 0;
  const local = [], central = [];
  const entries = Array.isArray(files) ? files : Object.entries(files);
  for (const [file, text] of entries) {
    const name = Buffer.from(`${options.prefix ?? "atlas-ask-eureka/"}${file}`), content = Buffer.from(text);
    const packed=options.deflate?deflateRawSync(content):content,method=options.deflate?8:0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(method, 8); header.writeUInt32LE(crc32(content), 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, packed);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(0x0314, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(method, 10); index.writeUInt32LE(crc32(content), 16); index.writeUInt32LE(packed.length, 20); index.writeUInt32LE(content.length, 24); index.writeUInt16LE(name.length, 28); index.writeUInt32LE(((options.symlink === file ? 0xa1ff : 0x81a4) * 65536) >>> 0, 38); index.writeUInt32LE(offset, 42);
    central.push(index, name); offset += header.length + name.length + packed.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}

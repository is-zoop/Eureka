import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

/** Keep Mermaid's complete, upstream browser bundle outside Next's module graph. */
export function prepareBrowserAssets(root) {
  const bytes = readFileSync(join(root, "node_modules", "mermaid", "dist", "mermaid.min.js"));
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const directory = join(root, "public", "vendor", "mermaid");
  const name = `mermaid-${digest}.min.js`, target = join(directory, name);
  mkdirSync(directory, { recursive: true });
  if (!existsSync(target)) {
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, target);
  }
  return { mermaidUrl: `/vendor/mermaid/${name}` };
}

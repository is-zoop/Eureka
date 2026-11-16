import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = new URL("../lib/automation-sdk-contract.json", import.meta.url), directory = new URL("../integrations/haze/", import.meta.url);
const bytes = await readFile(source), contract = JSON.parse(bytes), manifest = JSON.stringify({ sdkVersion: contract.sdkVersion, sha256: createHash("sha256").update(bytes).digest("hex") }, null, 2) + "\n";
const fixtures = await readFile(new URL("../lib/automation-sdk-contract-fixtures.json", import.meta.url));
const outputs = [["automation-sdk-contract.json", bytes], ["manifest.json", manifest], ["contract-fixtures.json", fixtures]];
if (process.argv.includes("--check")) {
  for (const [name, expected] of outputs) if (!(await readFile(new URL(name, directory))).equals(Buffer.from(expected))) throw new Error(`Stale Haze SDK contract: ${name}`);
} else {
  await mkdir(directory, { recursive: true }); for (const [name, value] of outputs) await writeFile(new URL(name, directory), value);
}
console.log(`SDK ${contract.sdkVersion}: Haze contract ${process.argv.includes("--check") ? "verified" : "exported"}`);

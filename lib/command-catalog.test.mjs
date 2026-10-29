import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const { readCommandResources } = await jiti.import("./command-catalog.ts");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { trustProject } = await jiti.import("./project-trust.ts");

test("a dormant command directory discovers skills/prompts without executing trusted extensions", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "eureka-command-catalog-"));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  const cwd = join(root, "project"), agentDir = join(root, "agent");
  const marker = join(root, "extension-ran");
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  mkdirSync(join(cwd, ".pi", "skills", "demo"), { recursive: true });
  mkdirSync(join(cwd, ".pi", "prompts"), { recursive: true });
  mkdirSync(agentDir);
  writeFileSync(join(cwd, ".pi", "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo skill\ndisable-model-invocation: true\n---\nDemo");
  writeFileSync(join(cwd, ".pi", "prompts", "quick.md"), "---\ndescription: Quick prompt\n---\nPrompt body");
  writeFileSync(join(cwd, ".pi", "extensions", "slow.ts"), `import { writeFileSync } from 'node:fs'; export default function () { writeFileSync(${JSON.stringify(marker)}, 'executed'); throw new Error('Command discovery must not execute this extension'); }`);
  trustProject(cwd, agentDir);
  const registry = globalThis.__piSessions;
  const result = await readCommandResources(cwd, agentDir);
  assert.ok(result.commands.some((command) => command.name === "skill:demo" && command.source === "skill"));
  assert.ok(result.commands.some((command) => command.name === "quick" && command.source === "prompt"));
  assert.equal(result.skills.find((skill) => skill.name === "demo").disableModelInvocation, true);
  assert.equal(existsSync(marker), false);
  assert.equal(globalThis.__piSessions, registry);
});

test("live command reads do not wait for session_start to finish", async () => {
  const expected = { commands: [{ name: "demo", source: "extension" }] };
  const wrapper = {
    resetIdleTimer() {},
    shouldWaitForExtensions: AgentSessionWrapper.prototype.shouldWaitForExtensions,
    waitForExtensionsBound: () => { throw new Error("must not wait"); },
    getCommandSnapshot: () => expected,
  };
  assert.equal(await AgentSessionWrapper.prototype.send.call(wrapper, { type: "get_commands" }), expected);
});

test("command menus use the read-only directory and skill metadata shares its loader", async () => {
  const [route, hook, skills] = await Promise.all([
    readFile(new URL("../app/api/commands/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/skills/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(route, /startRpcSession|ensureNewSession/);
  assert.match(route, /isExistingFilePathAllowed/);
  assert.match(skills, /metadataOnly[\s\S]*loadCommandResources/);
  const load = hook.slice(hook.indexOf("  const loadSlashCommands ="), hook.indexOf("  const cancelEventStreamGrace"));
  assert.doesNotMatch(load, /ensureNewSession/);
  assert.match(load, /\/api\/commands\?/);
  assert.match(load, /slashCommandRequestRef\.current === request/);
});

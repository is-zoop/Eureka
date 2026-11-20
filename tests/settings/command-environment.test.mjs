import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { commandTools, sessionCommandEnvironment, COMMAND_ENVIRONMENT_ENTRY } = await jiti.import("../../features/settings/shared/command-environment.ts");
const { readCommandEnvironment, writeCommandEnvironment } = await jiti.import("../../server/agent/command-environment-store.ts");
const { getPresetFromTools, PRESET_DEFAULT, PRESET_FULL } = await jiti.import("../../features/chat/shared/tool-presets.ts");

test("PowerShell keeps permission levels and a session's chosen environment across read-only/disabled tools", () => {
  const entries = [{ type: "custom", customType: COMMAND_ENVIRONMENT_ENTRY, data: { environment: "powershell" } }];
  assert.equal(sessionCommandEnvironment(entries, []), "powershell");
  assert.deepEqual(commandTools([], "powershell"), []);
  assert.deepEqual(commandTools(["read", "ls"], "powershell"), ["read", "ls"]);
  for (const [preset, names] of [["default", PRESET_DEFAULT], ["full", PRESET_FULL]]) {
    const converted = commandTools(names, "powershell");
    assert.ok(converted.includes("powershell")); assert.ok(!converted.includes("bash"));
    assert.equal(getPresetFromTools(converted.map(name => ({ name, active: true }))), preset);
  }
  assert.equal(sessionCommandEnvironment([], ["powershell"]), "powershell");
  assert.equal(sessionCommandEnvironment([]), "bash");
});

test("command settings preserve the Bash default and reject PowerShell outside native Windows", async t => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-command-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(await readCommandEnvironment(dir), "bash");
  await assert.rejects(writeCommandEnvironment("powershell", dir, "linux"));
  await writeCommandEnvironment("powershell", dir, "win32");
  assert.equal(await readCommandEnvironment(dir), "powershell");
  await writeCommandEnvironment("bash", dir, "win32");
  assert.equal(await readCommandEnvironment(dir), "bash");
  await assert.rejects(writeCommandEnvironment("cmd", dir, "win32"));
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url);
const { chatMessageFromEvent } = await jiti.import("../../features/chat/shared/streaming-message.ts");
const { userMessageKey, appendDeliveredUserMessage } = await jiti.import("../../server/agent/prompt-recovery.ts");

test("real SDK system checkpoints reproduce the old duplicate and do not interrupt the optimistic echo after filtering", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-message-echo-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  await writeFile(join(dir, "auth.json"), "{}");
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, modelsStorePath: join(dir, "models-store.json"), refreshOnCreate: false });
  runtime.registerProvider("echo-fixture", { api: "openai-completions", baseUrl: "https://unused.invalid/v1", apiKey: "fixture", models: [{ id: "fixture", name: "Fixture", input: ["text"], reasoning: false, contextWindow: 8192, maxTokens: 64, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  runtime.registerNativeProvider({ ...runtime.getProvider("echo-fixture"), streamSimple: () => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: { role: "assistant", provider: "echo-fixture", model: "fixture", api: "openai-completions", content: [{ type: "text", text: "Hello!" }], stopReason: "stop", timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } })); return stream;
  } });
  const services = await createAgentSessionServices({ cwd: dir, agentDir: dir, modelRuntime: runtime, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }), resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true } });
  const manager = SessionManager.inMemory(dir);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: manager, model: runtime.getModel("echo-fixture", "fixture") });
  t.after(() => session.dispose());
  let displayed = [], pendingKey = null;
  const completed = [];
  session.subscribe((event) => {
    if (event.type !== "message_end") return;
    completed.push(event.message);
    const message = chatMessageFromEvent(event.message);
    if (!message) return;
    if (message.role === "user") {
      displayed = appendDeliveredUserMessage(displayed, message, pendingKey); pendingKey = null;
    } else displayed = [...displayed, message];
  });
  const submit = async () => {
    const optimistic = { role: "user", content: "hello", timestamp: Date.now() };
    displayed = [...displayed, optimistic]; pendingKey = userMessageKey(optimistic);
    await session.prompt("hello");
  };
  await submit();
  assert.equal(completed[0].role, "system", "SDK 1.5 sends its prompt/tool checkpoint before the user echo");
  assert.deepEqual(displayed.map((message) => message.role), ["user", "assistant"]);
  assert.equal(manager.getEntries().filter((entry) => entry.type === "message" && entry.message.role === "user").length, 1);

  // Replaying the unfiltered old path demonstrates the exact reported bug.
  const original = { role: "user", content: "hello" };
  let old = [original], oldPending = userMessageKey(original);
  for (const message of completed) {
    if (message.role === "user") { old = appendDeliveredUserMessage(old, message, oldPending); oldPending = null; }
    else old.push(message);
  }
  assert.equal(old.filter((message) => message.role === "user").length, 2);

  await submit();
  assert.deepEqual(displayed.map((message) => message.role), ["user", "assistant", "user", "assistant"], "two intentional identical submissions remain separate");
});

test("both live event handlers filter transcript-only messages before changing chat or stream state", async () => {
  const source = await readFile(new URL("../../features/chat/client/useAgentSession.ts", import.meta.url), "utf8");
  assert.match(source, /const msg = chatMessageFromEvent\(event\.message\);\s*if \(!msg\) break;/);
  assert.match(source, /const completed = chatMessageFromEvent\(event\.message\);\s*if \(!completed\) break;/);
  for (const value of [null, { role: "system", content: "Private system prompt", toolsAdded: [] }, { role: "future_metadata" }]) assert.equal(chatMessageFromEvent(value), undefined);
  for (const role of ["user", "assistant", "toolResult", "custom", "bashExecution"]) {
    const value = { role, content: [] };
    assert.equal(chatMessageFromEvent(value), value);
  }
});

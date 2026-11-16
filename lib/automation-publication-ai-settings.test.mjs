import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parsePublicationAiSettings } = await jiti.import("./automation-publication-ai-settings.ts");
const { readPublicationAiSettings, writePublicationAiSettings } = await jiti.import("./automation-publication-ai-store.ts");

test("publication model preferences roundtrip independently and can return to defaults", async () => {
  const base = await mkdtemp(join(tmpdir(), "publication-ai-settings-"));
  try {
    assert.deepEqual(await readPublicationAiSettings(base), { model: null, thinkingLevel: null, timeoutMs: 180000, maxTokens: 8000 });
    const settings = { model: { provider: "xai", modelId: "grok-4.7" }, thinkingLevel: "medium", timeoutMs: 300000, maxTokens: 16000 };
    await writePublicationAiSettings(settings, base);
    assert.deepEqual(await readPublicationAiSettings(base), settings);
    await assert.rejects(writePublicationAiSettings({ ...settings, thinkingLevel: "invented" }, base));
    assert.deepEqual(await readPublicationAiSettings(base), settings);
    await assert.rejects(writePublicationAiSettings({ model: null, thinkingLevel: null }, base, () => { throw new Error("workspace changed"); }), /workspace changed/);
    assert.deepEqual(await readPublicationAiSettings(base), settings);
    await writePublicationAiSettings({ model: null, thinkingLevel: null }, base);
    assert.deepEqual(await readPublicationAiSettings(base), { model: null, thinkingLevel: null, timeoutMs: 180000, maxTokens: 8000 });
    await writeFile(join(base, "automation-publication-ai.json"), "corrupt");
    await assert.rejects(readPublicationAiSettings(base));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("publication AI configuration rejects incomplete values and credential fields", () => {
  for (const value of [null, {}, [], { model: null }, { model: { provider: "", modelId: "test" }, thinkingLevel: null }, { model: { provider: "test", modelId: "test", apiKey: "private" }, thinkingLevel: null }, { model: null, thinkingLevel: null, apiKey: "private" }]) assert.throws(() => parsePublicationAiSettings(value));
  for (const thinkingLevel of [null, "off", "minimal", "low", "medium", "high", "xhigh", "max"]) assert.equal(parsePublicationAiSettings({ model: null, thinkingLevel }).thinkingLevel, thinkingLevel);
});

test("legacy preferences acquire default limits and invalid limits are rejected", () => {
  const legacy = { model: null, thinkingLevel: null };
  assert.deepEqual(parsePublicationAiSettings(legacy), { ...legacy, timeoutMs: 180000, maxTokens: 8000 });
  for (const timeoutMs of [null, 0, 9999, 10001, 1800001, "180000", Infinity]) assert.throws(() => parsePublicationAiSettings({ ...legacy, timeoutMs }));
  for (const maxTokens of [null, 0, 255, 128001, 8000.5, "8000", Infinity]) assert.throws(() => parsePublicationAiSettings({ ...legacy, maxTokens }));
});

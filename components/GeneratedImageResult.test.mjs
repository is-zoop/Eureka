import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { TaskTurnView } = await jiti.import("./TaskTurnView.tsx");
const { generatedImageId } = await jiti.import("./GeneratedImageResult.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const id = "12345678-1234-1234-1234-123456789012";
test("a generated image remains visible outside folded processing, with duplicate phase references merged", () => {
  const block = { type: "toolCall", toolCallId: "call", toolName: "eureka_generate_image", input: { prompt: "cat" } };
  const ref = { block, blockIndex: 0, source: { messageIndex: 1, message: { role: "assistant", content: [block] } } };
  const turn = { status: "completed", answerBlockIndices: [], phases: [{ id: "phase", status: "completed", summary: [], items: [ref, ref], toolCallCount: 1, thinkingCount: 0, fallbackKey: "chat.processDetails" }] };
  const toolResults = new Map([["call", { role: "toolResult", toolCallId: "call", content: [], details: { eurekaGeneratedImage: { id } } }]]);
  const render = () => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(TaskTurnView, { turn, toolResults })));
  const html = render();
  assert.match(html, /aria-expanded="false"/); assert.match(html, /Loading image/);
  assert.equal((html.match(/data-slot="settings-card"/g) ?? []).length, 1);
  toolResults.get("call").isError = true;
  assert.doesNotMatch(render(), /Loading image/);
});
test("only this tool's valid saved image IDs can render a preview", () => {
  assert.equal(generatedImageId("eureka_generate_image", { eurekaGeneratedImage: { id } }), id);
  assert.equal(generatedImageId("mcp_fake", { eurekaGeneratedImage: { id } }), undefined);
  assert.equal(generatedImageId("eureka_generate_image", { eurekaGeneratedImage: { id: "https://external.invalid/image.png" } }), undefined);
  assert.equal(generatedImageId("eureka_generate_image", { eurekaGeneratedImage: { id: "../auth.json" } }), undefined);
});

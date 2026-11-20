import { randomUUID } from "node:crypto";
import { getAgentDir, type InlineExtension, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getProviderModelRuntime } from "../models/provider-model-runtime";
import { localAutomationContext } from "../../features/automation/runtime/automation-local-context";
import { GeneratedImageStore, ImageGenerationError, generateOneImage } from "../../features/chat/server/generated-images";
import { isSessionPromptSuppressed } from "./session-prompt-policy";
import { activeAutomationTask } from "../../features/automation/runtime/automation-mode-store";
import { readPlanState } from "../../features/chat/shared/plan-mode";

export const IMAGE_GENERATION_TOOL = "eureka_generate_image";
/** Require a direct request, not a quoted document, explanation or negative example. */
export function isImageGenerationRequest(prompt: string) {
  const text = prompt.trim();
  const firstLine = text.split(/[\r\n]/)[0];
  if (/(?:不要|别|无需|不需要|do not|don't|never)\s*(?:生成|绘制|画|generate|draw|create).{0,12}(?:图|image|picture)/i.test(firstLine)
    || /(?:图片|image|picture).{0,8}(?:提示词|prompt|教程|代码|接口|操作步骤|示例)/i.test(firstLine)) return false;
  if (/^(?:不要|别|无需|不需要|解释|说明|如何|怎么|总结|分析|阅读|翻译|what|how|explain|summari[sz]e|do not|don't|never)/i.test(text)) return false;
  if (/^(?:(?:请|麻烦|现在|直接|please)\s*)?(?:(?:帮我|给我|为我|我想要?|我需要)\s*)?(?:画|绘制|draw)\s*.+/i.test(text)) return true;
  return /^(?:(?:请|麻烦|现在|直接|please)\s*)?(?:(?:帮我|给我|为我|我想要?|我需要)\s*)?(?:生成|画|绘制|制作|设计|generate|draw|create|make|design)[\s\S]{0,100}?(?:图|海报|插画|壁纸|头像|logo|image|picture|poster|illustration|wallpaper|portrait)/i.test(text);
}
export function createImageGenerationExtension(dependencies: {
  getRuntime?: () => Promise<Pick<ModelRuntime, "getAvailableOfType" | "generateImages">>;
  createStore?: () => GeneratedImageStore;
} = {}): InlineExtension { return {
  name: "eureka-image-generation", hidden: true,
  factory: pi => {
    let allowed = false, used = false;
    pi.on("before_agent_start", async (event, ctx) => {
      allowed = false; used = false;
      const active = pi.getActiveTools().filter(name => name !== IMAGE_GENERATION_TOOL);
      pi.setActiveTools(active);
      const plan = readPlanState(ctx.sessionManager.getEntries() as unknown as Parameters<typeof readPlanState>[0]);
      if (event.messageType !== "user" || !isImageGenerationRequest(event.prompt)
        || isSessionPromptSuppressed(ctx.sessionManager) || activeAutomationTask(ctx.sessionManager)
        || plan.planModeActive || !active.some(name => ["write", "edit", "bash", "powershell"].includes(name))) return;
      allowed = true;
      pi.setActiveTools([...active, IMAGE_GENERATION_TOOL]);
      let models: { provider: string; modelId: string; name: string }[] = [];
      try { const runtime = await (dependencies.getRuntime ?? getProviderModelRuntime)(); models = (await runtime.getAvailableOfType("image")).slice(0, 60).map(m => ({ provider: m.provider, modelId: m.id, name: m.name })); } catch { /* The tool will report a safe configuration error. */ }
      return { message: { customType: "eureka_image_models", display: false, content: JSON.stringify({ imageModels: models, instructions: "Only use eureka_generate_image for this explicit user image request. Generate one image at most; never retry a failed generation in this run. Use one of these image models, keep the user's subject and constraints. When no image models are available, explain that an image-capable provider (currently SDK OpenRouter or an installed image-provider extension) needs to be configured in Settings / Models. ChatGPT/Codex chat access alone does not establish image API access. Do not replace generation with shell, network commands or an unrelated provider. The host displays a preview and Save button after success; do not repeat the image as a Markdown URL." }) } };
    });
    pi.on("session_shutdown", () => { allowed = false; });
    pi.registerTool({
      name: IMAGE_GENERATION_TOOL, label: "生成图片", defaultActive: false,
      description: "Generate exactly one new image for an explicit request in the latest user message. Requires write-capable tool permissions and an available IMAGE model from the host's imageModels list, not the main chat model. Each run permits at most one attempt, with no automatic retry. Returns a saved image reference for the host preview and Save As control. Not for image edits, batches, quoted instructions, explanations, plans, or automation.",
      parameters: Type.Object({ provider: Type.String({ minLength: 1, maxLength: 200 }), modelId: Type.String({ minLength: 1, maxLength: 300 }), prompt: Type.String({ minLength: 1, maxLength: 6000 }) }, { additionalProperties: false }),
      async execute(_id, input, signal, _update, ctx) {
        const plan = readPlanState(ctx.sessionManager.getEntries() as unknown as Parameters<typeof readPlanState>[0]);
        if (!allowed || used || isSessionPromptSuppressed(ctx.sessionManager) || activeAutomationTask(ctx.sessionManager)
          || plan.planModeActive || !pi.getActiveTools().includes(IMAGE_GENERATION_TOOL)) throw new Error("Image generation is not authorized for this run, or its one attempt has already been used. Do not retry.");
        used = true;
        try {
          const store = dependencies.createStore ? dependencies.createStore() : (() => { const identity = localAutomationContext(); return new GeneratedImageStore(getAgentDir(), identity.ownerKey, identity.assertIdentity); })();
          const runtime = await (dependencies.getRuntime ?? getProviderModelRuntime)();
          const item = await generateOneImage(store, runtime, { id: randomUUID(), ...input }, signal ?? new AbortController().signal);
          return { content: [{ type: "text", text: JSON.stringify({ status: item.status, imageId: item.id, model: item.modelId, message: "Image generated and saved locally. The host displays the image preview and Save button." }) }], details: { eurekaGeneratedImage: { id: item.id } } };
        } catch (error) {
          const code = error instanceof ImageGenerationError ? error.code : "provider";
          throw new Error(`Image generation failed (${code}). No automatic retry. Check the image provider, credentials and quota; never assume chat subscription access includes image generation.`);
        }
      },
    });
  },
}; }

export const EUREKA_IMAGE_GENERATION_EXTENSION = createImageGenerationExtension();

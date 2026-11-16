import { applicationAccess, appJson, appFailure } from "@/lib/automation-app-server";
import { AutomationAppError } from "@/lib/automation-app-package";
import { getProviderModelRuntime } from "@/lib/provider-model-runtime";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const auth = await applicationAccess(request), runtime = await getProviderModelRuntime();
    const models = await runtime.getAvailableOfType("classifier"); auth.assertIdentity();
    return appJson({ models: models.map(model => ({ provider: model.provider, id: model.id, name: model.name, input: model.input })) });
  } catch (error) { return appFailure(error instanceof AutomationAppError ? error : new AutomationAppError("分类模型读取失败，请检查模型配置。", 500)); }
}

import { appDownload, appFailure, appJson, automationAppAccess, readAppRequest } from "@/lib/automation-app-server";
import { AutomationAppError, MAX_APP_ZIP, parseAutomationAppArchive } from "@/lib/automation-app-package";
import { automationExampleArchive, fileAutomationExample } from "@/lib/automation-app-example";
import { browserAutomationExample } from "@/lib/automation-app-browser-example";
import { isApiRequestAllowed } from "@/lib/request-security";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const auth = await automationAppAccess(request, { ownerKey: query.get("ownerKey"), runtimeId: query.get("runtimeId") });
    const example = query.get("example");
    if (example) {
      if (/^browser-(queries|operations)-(1\.0\.0|1\.1\.0)$/.test(example)) {
        if(process.env.NODE_ENV!=="development")throw new AutomationAppError("模拟网页验收包只在开发服务提供",404);
        const [,kind,version]=example.match(/^browser-(queries|operations)-(1\.0\.0|1\.1\.0)$/)!;
        auth.assertIdentity();return appDownload(browserAutomationExample(kind as "queries"|"operations",version),`${example}.zip`);
      }
      if (!["1.0.0", "1.1.0", "files-1.0.0", "files-1.1.0"].includes(example)) throw new AutomationAppError("示例版本不存在", 404);
      const runnable = example.startsWith("files-"), version = example.replace(/^files-/, ""), bytes = runnable ? fileAutomationExample(version) : automationExampleArchive(version);
      auth.assertIdentity(); return appDownload(bytes, `${runnable ? "file-list-sdk-example" : "file-list-package-example"}-${version}.zip`);
    }
    const id = query.get("id"); if (!id) throw new AutomationAppError("缺少应用 ID");
    await auth.store.useLatest(); const install = await auth.store.find(id), version = query.get("version");
    if (version && version !== install?.activeVersion) throw new AutomationAppError("仅支持导出最新应用版本", 409);
    const result = await auth.store.export(id); auth.assertIdentity(); return appDownload(result.bytes, result.filename);
  } catch (e) { return appFailure(e); }
}
export async function POST(request: Request) {
  try {
    if (!isApiRequestAllowed(request) || request.headers.get("content-type")?.split(";")[0] !== "application/zip") throw new AutomationAppError("请选择 ZIP 应用包", 400);
    const query = new URL(request.url).searchParams;
    const auth = await automationAppAccess(request, { ownerKey: query.get("ownerKey"), runtimeId: query.get("runtimeId") });
    const mode = query.get("mode"); if (!["inspect", "install"].includes(mode ?? "")) throw new AutomationAppError("应用包操作无效");
    const pkg = parseAutomationAppArchive(await readAppRequest(request, MAX_APP_ZIP)); auth.assertIdentity();
    if (mode === "inspect") {
      const existing = await auth.store.find(pkg.manifest.automation.id);
      return appJson({ manifest: pkg.manifest, ui: pkg.ui, workflow: pkg.workflow, files: [...pkg.files.keys()], digest: pkg.digest, existingRevision: existing?.revision ?? 0, existingVersion: existing?.activeVersion ?? null });
    }
    const revision = Number(query.get("revision"));
    if (!query.has("revision") || !Number.isSafeInteger(revision) || revision < 0 || query.get("digest") !== pkg.digest) throw new AutomationAppError("预览内容已变化，请重新选择应用包", 409);
    const install = await auth.store.install(pkg, revision); auth.assertIdentity(); return appJson(install);
  } catch (e) { return appFailure(e); }
}

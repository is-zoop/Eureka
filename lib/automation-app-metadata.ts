import { AutomationAppError, inspectAutomationFiles, type AutomationAppPackage } from "./automation-app-package";
import { isAppId } from "./automation-app";

/** Only the display title is editable here; executable files and declarations stay identical. */
export function withAutomationAppName(pkg: AutomationAppPackage, value?: unknown): AutomationAppPackage {
  if (value === undefined) return pkg;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(value)) throw new AutomationAppError("请填写 1～100 字的应用名称，不包含换行或控制字符。", 400);
  const name = value.trim();
  if (name === pkg.manifest.displayName) return pkg;
  const files = new Map(pkg.files), manifest = JSON.parse(files.get("plugin.json")!.toString("utf8"));
  manifest.extensions["com.eureka"].displayName = name;
  files.set("plugin.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  return inspectAutomationFiles(files);
}

/** Fork published code only. Configuration, grants and runtime data are never inputs. */
export function copyAutomationAppPackage(pkg: AutomationAppPackage, targetId: unknown, displayName: unknown): AutomationAppPackage {
  if (!isAppId(targetId) || targetId === pkg.manifest.automation.id) throw new AutomationAppError("另存应用需要新的应用 ID。", 400);
  if (typeof displayName !== "string") throw new AutomationAppError("请填写应用名称。", 400);
  const renamed = withAutomationAppName(pkg, displayName), files = new Map(renamed.files);
  const manifest = JSON.parse(files.get("plugin.json")!.toString("utf8")), module = JSON.parse(files.get("package.json")!.toString("utf8"));
  manifest.name = module.name = `automation-${targetId}`;
  manifest.version = module.version = "1.0.0";
  manifest.extensions["com.eureka"].automation.id = targetId;
  files.set("plugin.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  files.set("package.json", Buffer.from(JSON.stringify(module, null, 2) + "\n"));
  return inspectAutomationFiles(files);
}

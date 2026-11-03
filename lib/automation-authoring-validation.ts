import type { AutomationAppDetail } from "./automation-app";
import { appJsonValue } from "./automation-app-run";
import type { AuthorCandidate, AuthorCheck, AuthorFinding, AuthorState } from "./automation-authoring-types";

/** Private rules can change without changing executable bytes or file grants. */
export function parseAuthorChecks(raw: unknown, detail: Pick<AutomationAppDetail,"ui">, evidence: AuthorState["evidence"]): AuthorCheck[] {
  if (!Array.isArray(raw) || raw.length > 64) throw new Error("校验规则需要数组，最多 64 条；空数组仅可保存未校验草稿。");
  for (const check of raw) {
    if (!check || typeof check !== "object" || Array.isArray(check) || !["result","artifact","file"].includes(check.source) || check.expected === undefined && !check.evidenceId) throw new Error("校验必须指定真实证据或声明的预期结果。");
    for (const path of [check.path,check.evidencePath]) if (path !== undefined && (typeof path !== "string" || path.length > 2000 || path !== "" && !path.startsWith("/") || /~(?![01])/.test(path))) throw new Error("校验路径需要 JSON Pointer。");
    if (check.evidenceId !== undefined && (typeof check.evidenceId !== "string" || !evidence.some(entry => entry.id === check.evidenceId))) throw new Error("校验证据不属于本次任务。");
    if (check.source === "artifact" && (typeof check.name !== "string" || !check.name)) throw new Error("产物校验需要实际文件名。");
    if (check.source === "file" && (typeof check.fieldId !== "string" || !detail.ui.fields.some(field => field.id === check.fieldId && ["file","directory"].includes(field.type)))) throw new Error("文件校验需要用户选择的文件配置项。");
    if (check.format !== undefined && !["text","json"].includes(check.format) || check.relative !== undefined && typeof check.relative !== "string") throw new Error("文件校验格式或相对路径无效。");
    appJsonValue(check,64000);
  }
  return appJsonValue(raw,1024*1024) as unknown as AuthorCheck[];
}

export function replaceAuthorChecks(candidate:AuthorCandidate,detail:Pick<AutomationAppDetail,"ui">,raw:unknown,evidence:AuthorState["evidence"],guard:{digest?:string;runId?:string}) {
  if(candidate.saved || guard.digest!==candidate.digest || guard.runId!==candidate.runId) throw new Error("代码或试运行记录已变化，请先读取当前任务，再修改所属校验规则。");
  const checks=parseAuthorChecks(raw,detail,evidence);
  candidate.checks=checks;delete candidate.validation;
}

const tokens = (path = "") => path === "" ? [] : path.slice(1).split("/").map(key => key.replace(/~1/g,"/").replace(/~0/g,"~"));
export function authorCheckPlan(detail: Pick<AutomationAppDetail,"ui"|"manifest">, checks: AuthorCheck[], evidence: AuthorState["evidence"]) {
  const results = checks.filter(check => check.source === "result");
  const missingColumns = detail.ui.results.columns.filter(column => !results.some(check => {
    const parts = tokens(check.path);
    return !parts.length || parts.length === 1 && /^\d+$/.test(parts[0]) || parts.at(-1) === column.key;
  })).map(column => column.label);
  const needsWebEvidence = detail.manifest.automation.capabilities.includes("browser.read") && !detail.manifest.automation.capabilities.includes("browser.write")
    && !checks.some(check => check.evidenceId && evidence.some(entry => entry.id === check.evidenceId && ["read","extract"].includes(entry.method)));
  const missingFileCheck=detail.manifest.automation.capabilities.includes("files.write")&&!checks.some(check=>["artifact","file"].includes(check.source));
  const blocking = [...(!checks.length ? ["尚未配置实际结果或产物校验"] : []), ...(missingColumns.length ? [`校验规则尚未覆盖：${missingColumns.join("、")}`] : []),...(missingFileCheck?["文件写入尚未配置实际文件或产物内容校验"]:[])];
  return {ready:blocking.length===0,blocking,missingColumns,needsWebEvidence};
}
export function authorColumnCoverage(detail: AutomationAppDetail, checks: AuthorCheck[], result: unknown): AuthorFinding[] {
  const rows = Array.isArray(result) ? result : [result];
  return detail.ui.results.columns.map(column => {
    const key = column.key.replace(/~/g,"~0").replace(/\//g,"~1");
    const missingFields:number[] = [], missingChecks:number[] = [];
    rows.forEach((row,index) => {
      const prefix = Array.isArray(result) ? `/${index}` : "";
      if (row === null || typeof row !== "object" || !Object.hasOwn(row,column.key)) missingFields.push(index);
      else if (!checks.some(check => check.source === "result" && (!check.path || check.path === prefix || check.path === `${prefix}/${key}`))) missingChecks.push(index);
    });
    const equal = rows.length > 0 && !missingFields.length && !missingChecks.length;
    return {label:`全部记录字段覆盖:${column.label}`,equal,...(!equal ? {reason:!rows.length||missingFields.length?"missing-field" as const:"missing-check" as const,rows:missingFields.length?missingFields:missingChecks,hint:!rows.length||missingFields.length?"实际结果缺少该字段或没有记录；不能按空值或零比较。":"字段可能已读到，但缺少逐条核对规则；可用完整结果比较覆盖全部记录。"} : {})};
  });
}

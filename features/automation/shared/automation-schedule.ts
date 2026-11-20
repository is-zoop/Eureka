import type { AppJson } from "../runtime/automation-app-run";
import type { RelativeDate } from "./automation-form";

export type ScheduleTiming = { kind: "once"; at: string } | { kind: "daily"; time: string } | { kind: "weekly"; time: string; days: number[] } | { kind: "interval"; minutes: number };
export type ScheduleEvent = { at: string; status: string; message?: string; runId?: string };
export interface AppSchedule {
  id: string; appId: string; appName: string; version: string; digest: string; actionId: string; actionLabel: string;
  values: Record<string, AppJson>; dates: Record<string, RelativeDate>; aiHash: string; browserHash: string;
  timing: ScheduleTiming; timeZone: string; enabled: boolean; revision: number; nextAt: string | null;
  createdAt: string; updatedAt: string; history: ScheduleEvent[];
}
export function parseScheduleTiming(value: unknown): ScheduleTiming {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("定时设置无效。");
  const v = value as Record<string, unknown>, keys = v.kind === "once" ? ["kind", "at"] : v.kind === "daily" ? ["kind", "time"] : v.kind === "weekly" ? ["kind", "time", "days"] : v.kind === "interval" ? ["kind", "minutes"] : [];
  if (!keys.length || Object.keys(v).some(k => !keys.includes(k))) throw new Error("定时类型或设置无效。");
  if (v.kind === "once") { if (typeof v.at !== "string" || v.at.length > 40 || !Number.isFinite(Date.parse(v.at))) throw new Error("请选择有效的运行时间。"); return { kind: "once", at: new Date(v.at).toISOString() }; }
  if (v.kind === "interval") { if (!Number.isSafeInteger(v.minutes) || Number(v.minutes) < 1 || Number(v.minutes) > 10080) throw new Error("运行间隔需要为 1～10080 分钟。"); return { kind: "interval", minutes: v.minutes as number }; }
  if (typeof v.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v.time)) throw new Error("请选择有效的每日时间。");
  if (v.kind === "daily") return { kind: "daily", time: v.time };
  if (!Array.isArray(v.days) || !v.days.length || v.days.length > 7 || new Set(v.days).size !== v.days.length || v.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("请选择有效的星期。");
  return { kind: "weekly", time: v.time, days: [...v.days].sort() };
}
/** Local wall-clock recurrence, always strictly after the supplied time. */
export function nextScheduleAt(timing: ScheduleTiming, after: number): string | null {
  if (timing.kind === "once") return Date.parse(timing.at) > after ? timing.at : null;
  if (timing.kind === "interval") return new Date(after + timing.minutes * 60000).toISOString();
  const [hour, minute] = timing.time.split(":").map(Number);
  for (let offset = 0; offset < 9; offset++) { const date = new Date(after); date.setDate(date.getDate() + offset); date.setHours(hour, minute, 0, 0); if (date.getTime() > after && (timing.kind === "daily" || timing.days.includes(date.getDay()))) return date.toISOString(); }
  throw new Error("无法计算下次运行时间。");
}

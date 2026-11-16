import type { AutomationAppUi } from "./automation-app";

export type RelativeDate = "today" | "yesterday" | "tomorrow";
export type AppFormPreferences = { layout?: AutomationAppUi["layout"] };
export function relativeAppDate(relative: RelativeDate, now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + (relative === "yesterday" ? -1 : relative === "tomorrow" ? 1 : 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function appFieldDefault(field: AutomationAppUi["fields"][number], now = new Date()): unknown {
  const value = field.default;
  if (field.type === "date" && value && typeof value === "object" && "relative" in value) return relativeAppDate((value as { relative: RelativeDate }).relative, now);
  return value ?? null;
}
export function parseAppFormLayout(raw: unknown, ids: string[]): NonNullable<AutomationAppUi["layout"]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("配置布局必须为对象。");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !["columns", "order", "spans"].includes(key)) || !Number.isInteger(value.columns) || Number(value.columns) < 1 || Number(value.columns) > 4) throw new Error("每行配置项数量必须为 1–4。");
  if (value.order !== undefined && (!Array.isArray(value.order) || value.order.some(id => typeof id !== "string" || !ids.includes(id)) || new Set(value.order).size !== value.order.length)) throw new Error("配置项排列顺序无效。");
  if (value.spans !== undefined && (!value.spans || typeof value.spans !== "object" || Array.isArray(value.spans) || Object.entries(value.spans).some(([id, span]) => !ids.includes(id) || !Number.isInteger(span) || Number(span) < 1 || Number(span) > Number(value.columns)))) throw new Error("配置项宽度无效。");
  return { columns: Number(value.columns), ...(value.order ? { order: value.order as string[] } : {}), ...(value.spans ? { spans: value.spans as Record<string, number> } : {}) };
}
export function appFormFields(ui: AutomationAppUi, layout = ui.layout) {
  const order = layout?.order ?? [];
  return [...ui.fields].sort((a, b) => {
    const rank = (id: string) => order.includes(id) ? order.indexOf(id) : order.length + ui.fields.findIndex(field => field.id === id);
    return rank(a.id) - rank(b.id);
  });
}
/** SDK defaults are authoritative; historical browser date preferences are ignored. */
export function seedAppForm(ui: AutomationAppUi, saved: Record<string, unknown>, now = new Date()) {
  return Object.fromEntries(ui.fields.map(field => {
    const dynamic = field.type === "date" && typeof field.default === "object" && field.default !== null && "relative" in field.default;
    return [field.id, dynamic ? appFieldDefault(field, now) : Object.hasOwn(saved, field.id) ? saved[field.id] : appFieldDefault(field, now)];
  }));
}

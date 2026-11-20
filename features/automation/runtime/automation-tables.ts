import ExcelJS from "exceljs";
import { parse } from "csv-parse";
import { stringify } from "csv-stringify/sync";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { AppFileOperations } from "./automation-app-files";
import type { StagedFile } from "./automation-stream-files";
import { readZipFileEntries, writeZipEntry } from "./automation-zip";
import { appJsonValue } from "./automation-app-run";
import contract from "../sdk/automation-sdk-contract.json";

type Column = { key: string; label?: string; type?: "text" | "number" | "boolean" | "date" | "formula"; width?: number; numFmt?: string };
type Options = { format: "csv" | "xlsx"; encoding?: string; delimiter?: string; bom?: boolean; overwrite?: boolean; maxBytes?: number; sheets?: { name: string; columns: Column[]; freezeRows?: number }[]; columns?: Column[]; escapeFormulas?: boolean };
type Reader = { iterator: AsyncGenerator<unknown>; close: () => Promise<void>; queue: Promise<unknown> };
type Writer = { stage: StagedFile; options: Options; book?: ExcelJS.stream.xlsx.WorkbookWriter; sheets: Map<string, { sheet: ExcelJS.Worksheet; columns: Column[]; rows: number }>; queue: Promise<unknown>; finish?: Promise<void>; stop?: () => void; rows: number };
function serial<T>(entry: { queue: Promise<unknown> }, work: () => Promise<T>) { const task = entry.queue.then(work); entry.queue = task.catch(() => {}); return task; }
function columns(value: unknown): Column[] {
  if (!Array.isArray(value) || !value.length || value.length > 256) throw new Error("表格需要 1～256 列。");
  const seen = new Set<string>();
  return value.map(column => {
    if (!column || typeof column.key !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(column.key) || seen.has(column.key) || column.label !== undefined && (typeof column.label !== "string" || column.label.length > 200) || column.type !== undefined && !["text", "number", "boolean", "date", "formula"].includes(column.type) || column.width !== undefined && (!Number.isFinite(column.width) || column.width < 1 || column.width > 255) || column.numFmt !== undefined && (typeof column.numFmt !== "string" || column.numFmt.length > 200)) throw new Error("表格列定义无效或 key 重复。");
    seen.add(column.key); return column;
  });
}
function cell(value: unknown, column: Column): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  if (column.type === "text") { if (!["string", "number", "boolean"].includes(typeof value)) throw new Error("文本列需要标量值。"); if (typeof value === "number" && !Number.isSafeInteger(value) && Number.isInteger(value)) throw new Error("长编号必须以文本传入，避免精度丢失。"); return String(value); }
  if (column.type === "number") { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("数字列需要有限数字。"); return value; }
  if (column.type === "boolean") { if (typeof value !== "boolean") throw new Error("布尔列需要 true/false。"); return value; }
  if (column.type === "date") { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) throw new Error("日期列需要 ISO 日期文本。"); const date = new Date(value); if (!Number.isFinite(date.getTime()) || value.length === 10 && date.toISOString().slice(0, 10) !== value) throw new Error("日期无效。"); return date; }
  if (column.type === "formula") {
    const formula = value as { formula?: string; result?: string | number | boolean };
    if (!formula || typeof formula !== "object" || typeof formula.formula !== "string" || !formula.formula || formula.formula.length > 8192 || Object.keys(formula).some(key => !["formula", "result"].includes(key)) || formula.result !== undefined && !["string", "number", "boolean"].includes(typeof formula.result) || typeof formula.result === "number" && !Number.isFinite(formula.result)) throw new Error("公式列需要 {formula,result?}，宿主不执行公式。");
    return { formula: formula.formula.replace(/^=/, ""), ...(formula.result !== undefined ? { result: formula.result } : {}) } as ExcelJS.CellFormulaValue;
  }
  if (["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value)) return value as ExcelJS.CellValue;
  throw new Error("单元格类型无效，请声明列类型。");
}
function plain(value: ExcelJS.CellValue): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      if (typeof value.result === "number" && !Number.isFinite(value.result)) throw new Error("此公式缓存类型无法可靠读取，请先在 Excel/WPS 重算保存。");
      return { ...value, result: value.result instanceof Date ? value.result.toISOString() : value.result ?? null };
    }
    if ("richText" in value) return value.richText.map(part => part.text).join("");
    if ("hyperlink" in value) return value.text;
  }
  return value ?? null;
}

/** Handles live only inside one run; scripts never receive host paths or library objects. */
export class AppTableOperations {
  private readers = new Map<string, Reader>(); private writers = new Map<string, Writer>();
  get hasOpenWriters() { return this.writers.size > 0; }
  constructor(private files: AppFileOperations, private check: () => void) {}
  async dispose() { const readers = [...this.readers.values()], writers = [...this.writers.values()]; this.readers.clear(); this.writers.clear(); await Promise.allSettled([...readers.map(reader => reader.close()), ...writers.map(async writer => { writer.stop?.(); await writer.finish?.catch(() => {}); await writer.stage.abort(); })]); }
  async call(method: string, args: unknown[]): Promise<unknown> {
    this.check();
    if (method === "openReader") {
      if (this.readers.size + this.writers.size >= contract.limits.tableHandles) throw new Error("每次运行最多打开 8 个表格句柄。");
      const options = args[1] as Options; if (!options || !["csv", "xlsx"].includes(options.format)) throw new Error("表格格式需要 csv 或 xlsx。");
      const path = await this.files.readPath(args[0]), info = await stat(path);
      if (!info.isFile() || info.size > (options.format === "xlsx" ? contract.limits.xlsxInputBytes : contract.limits.downloadBytes)) throw new Error("表格输入超过大小限制。");
      if (options.format === "xlsx") {
        const entries = await readZipFileEntries(path, { archive: contract.limits.xlsxInputBytes, expanded: contract.limits.xlsxExpandedBytes, file: contract.limits.xlsxExpandedBytes, entries: 10000 }, this.check);
        for (const entry of entries) await writeZipEntry(path, entry, new Writable({ write(_chunk, _encoding, done) { done(); } }), this.check);
      }
      const input = createReadStream(path); let parser: ReturnType<typeof parse> | undefined;
      const check = this.check;
      const iterator = options.format === "csv" ? (async function* () {
        const encoding = options.encoding ?? "utf-8"; if (!["utf-8", "utf8", "gbk", "gb18030", "utf-16le"].includes(encoding)) throw new Error("CSV 编码不支持。");
        const decoder = new TextDecoder(encoding, { fatal: true });
        const decode = new Transform({ transform(chunk, _encoding, done) { try { done(null, decoder.decode(chunk, { stream: true })); } catch (error) { done(error as Error); } }, flush(done) { try { done(null, decoder.decode()); } catch (error) { done(error as Error); } } });
        parser = parse({ bom: true, delimiter: options.delimiter ?? ",", max_record_size: 1024 * 1024, skip_empty_lines: true });
        input.on("error", error => parser?.destroy(error)); decode.on("error", error => parser?.destroy(error)); input.pipe(decode).pipe(parser);
        let row = 0; try { for await (const values of parser) { check(); yield { sheet: "CSV", row: ++row, values }; } } finally { decode.destroy(); parser.destroy(); input.destroy(); }
      })() : (async function* () {
        const book = new ExcelJS.stream.xlsx.WorkbookReader(input, { entries: "ignore", worksheets: "emit", sharedStrings: "cache", hyperlinks: "ignore", styles: "cache" });
        try { for await (const sheet of book) { for await (const row of sheet) { check(); yield { sheet: (sheet as unknown as {name:string}).name, row: row.number, values: Array.from({ length: row.cellCount }, (_, i) => plain(row.getCell(i + 1).value)) }; } } } finally { input.destroy(); }
      })();
      const id = randomUUID(); this.readers.set(id, { iterator, queue: Promise.resolve(), close: async () => { input.destroy(); parser?.destroy(); await iterator.return(undefined); } }); return { id };
    }
    if (method === "readRows" || method === "closeReader") {
      const reader = this.readers.get(String(args[0])); if (!reader) throw new Error("表格读取引用已关闭或不属于本次运行。");
      return serial(reader, async () => {
        if (method === "closeReader") { this.readers.delete(String(args[0])); await reader.close(); return null; }
        const limit = args[1] ?? 500; if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > contract.limits.tableBatchRows) throw new Error("单批最多读取 2000 行。");
        const rows: unknown[] = []; let bytes = 0;
        try { while (rows.length < Number(limit)) { this.check(); const row = await reader.iterator.next(); if (row.done) { this.readers.delete(String(args[0])); await reader.close(); return { rows, done: true }; } bytes += Buffer.byteLength(JSON.stringify(row.value)); if (bytes > 16 * 1024 * 1024) throw new Error("读取批次超过 16 MiB，请减少批次行数。"); rows.push(row.value); } return { rows, done: false }; }
        catch (error) { this.readers.delete(String(args[0])); await reader.close(); throw error; }
      });
    }
    if (method === "createWriter") {
      if (this.readers.size + this.writers.size >= contract.limits.tableHandles) throw new Error("每次运行最多打开 8 个表格句柄。");
      const options = args[1] as Options; if (!options || !["csv", "xlsx"].includes(options.format) || options.overwrite !== undefined && typeof options.overwrite !== "boolean") throw new Error("表格写入选项无效。");
      const definitions = options.format === "csv" ? [{ name: "CSV", columns: columns(options.columns) }] : options.sheets;
      if (!Array.isArray(definitions) || !definitions.length || definitions.length > 32) throw new Error("需要 1～32 个工作表。");
      const names = new Set<string>(); for (const definition of definitions) { if (typeof definition.name !== "string" || !definition.name || definition.name.length > 31 || /[\\/*?:\[\]]/.test(definition.name) || names.has(definition.name.toLowerCase())) throw new Error("工作表名称无效或重复。"); names.add(definition.name.toLowerCase()); columns(definition.columns); }
      const stage = await this.files.stage(args[0], options.overwrite, options.maxBytes);
      const writer: Writer = { stage, options, sheets: new Map(), rows: 0, queue: Promise.resolve() };
      try {
        if (options.format === "xlsx") {
          let size = 0; const output = createWriteStream(stage.path, { flags: "wx" });
          const guard = new Transform({ transform: (chunk, _encoding, done) => { try { this.check(); size += chunk.length; if (size > stage.maxBytes) throw new Error("表格输出超过文件大小上限。"); done(null, chunk); } catch (error) { done(error as Error); } } });
          writer.finish = pipeline(guard, output); void writer.finish.catch(() => {});
          writer.book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: guard, useStyles: true, useSharedStrings: false });
          writer.stop = () => { guard.destroy(); output.destroy(); (writer.book as unknown as { zip: { abort(): void } }).zip.abort(); };
          for (const definition of definitions) { const sheet = writer.book.addWorksheet(definition.name, { views: [{ state: "frozen", ySplit: definition.freezeRows ?? 1 }] }); sheet.columns = definition.columns.map(column => ({ key: column.key, width: column.width ?? 18, style: { numFmt: column.numFmt ?? (column.type === "text" ? "@" : column.type === "date" ? "yyyy-mm-dd" : "General") } })); sheet.addRow(definition.columns.map(column => column.label ?? column.key)).commit(); writer.sheets.set(definition.name, { sheet, columns: definition.columns, rows: 1 }); }
        } else {
          writer.sheets.set("CSV", { sheet: null as unknown as ExcelJS.Worksheet, columns: definitions[0].columns, rows: 1 });
          await stage.append(Buffer.from(stringify([definitions[0].columns.map(column => column.label ?? column.key)], { bom: options.bom !== false, delimiter: options.delimiter ?? ",", escape_formulas: options.escapeFormulas !== false })));
        }
        const id = randomUUID(); this.writers.set(id, writer); return { id };
      } catch (error) { writer.stop?.(); await writer.finish?.catch(() => {}); await stage.abort(); throw error; }
    }
    const writer = this.writers.get(String(args[0])); if (!writer) throw new Error("表格写入引用已关闭或不属于本次运行。");
    return serial(writer, async () => {
      try {
        if (method === "appendRows") {
          const rows = args[1], name = args[2] ?? writer.sheets.keys().next().value, sheet = writer.sheets.get(String(name));
          if (!sheet || !Array.isArray(rows) || rows.length > contract.limits.tableBatchRows) throw new Error("工作表不存在或批次超过 2000 行。");
          appJsonValue(rows, 16 * 1024 * 1024); if (sheet.rows + rows.length > 1048576) throw new Error("超出工作表行数上限。");
          const converted = rows.map(row => {
            if (!row || typeof row !== "object" || Array.isArray(row) && row.length > sheet.columns.length) throw new Error("表格行必须是对象或不超过列数的数组。");
            return sheet.columns.map((column, index) => cell(Array.isArray(row) ? row[index] : Object.hasOwn(row, column.key) ? row[column.key] : null, column));
          });
          if (writer.book) { for (const row of converted) { this.check(); sheet.sheet.addRow(row).commit(); } }
          else { const text = stringify(converted.map(row => row.map(value => value instanceof Date ? value.toISOString().slice(0, 10) : value && typeof value === "object" ? (value as ExcelJS.CellFormulaValue).result ?? "" : value)), { delimiter: writer.options.delimiter ?? ",", escape_formulas: writer.options.escapeFormulas !== false }); const bytes = Buffer.from(text); for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) await writer.stage.append(bytes.subarray(offset, offset + 1024 * 1024)); }
          writer.rows += rows.length; sheet.rows += rows.length; return { rows: writer.rows };
        }
        if (method === "abortWriter") { writer.stop?.(); await writer.finish?.catch(() => {}); await writer.stage.abort(); this.writers.delete(String(args[0])); return null; }
        if (method !== "commitWriter") throw new Error("表格方法不支持。");
        if (writer.book) { for (const { sheet } of writer.sheets.values()) sheet.commit(); await writer.book.commit(); await writer.finish; }
        const result = await writer.stage.commit(); this.writers.delete(String(args[0])); return { ...result, rows: writer.rows };
      } catch (error) { this.writers.delete(String(args[0])); writer.stop?.(); await writer.finish?.catch(() => {}); await writer.stage.abort(); throw error; }
    });
  }
}

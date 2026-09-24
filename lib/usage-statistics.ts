import { basename } from "path";
import { getSessionEntries, listAllSessions } from "@/lib/session-reader";
import type { AssistantMessage, SessionInfo, SessionMessageEntry } from "@/lib/types";

export const usageRanges = ["7d", "30d", "90d", "12m", "all"] as const;
export type UsageRange = typeof usageRanges[number];

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
  calls: number;
  usageCalls: number;
  costCalls: number;
  sessions: number;
  activeDays: number;
  toolCalls: number;
  cacheHitRate: number | null;
}

export interface UsageDay extends UsageTotals {
  date: string;
  topProject?: string;
  topModel?: string;
}

export interface UsageModel extends UsageTotals {
  provider: string;
  model: string;
  lastUsed: string;
}

export interface UsageProject extends UsageTotals {
  id: string;
  name: string;
  lastUsed: string;
  models: UsageModel[];
}

export interface UsageProvider extends UsageTotals {
  provider: string;
  lastUsed: string;
  models: UsageModel[];
}

export interface UsageStatistics {
  range: UsageRange;
  generatedAt: string;
  totals: UsageTotals;
  /** Always the latest twelve months, so the activity calendar keeps a stable shape. */
  days: UsageDay[];
  /** Days within the selected range, used by the range-sensitive trend chart. */
  trendDays: UsageDay[];
  projects: UsageProject[];
  providers: UsageProvider[];
}

interface UsageCall {
  id: string;
  sessionId: string;
  date: string;
  timestamp: number;
  projectId: string;
  projectName: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
  usageKnown: boolean;
  toolCalls: number;
}

interface UsageSourceSession {
  info: SessionInfo;
  entries: SessionMessageEntry[];
}

declare global {
  var __piUsageStatisticsCache: Map<string, { fingerprint: string; createdAt: number; data: UsageStatistics }> | undefined;
}

const CACHE_TTL_MS = 30_000;

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseTimestamp(value: unknown, fallback: string): Date | null {
  const candidate = typeof value === "number" ? new Date(value) : new Date(typeof value === "string" ? value : fallback);
  return Number.isFinite(candidate.getTime()) ? candidate : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function rangeStart(range: UsageRange): number | null {
  if (range === "all") return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (range === "12m") {
    today.setMonth(today.getMonth() - 12);
    return today.getTime();
  }
  today.setDate(today.getDate() - (Number.parseInt(range, 10) - 1));
  return today.getTime();
}

function emptyTotals(): Omit<UsageTotals, "cacheHitRate"> {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, calls: 0, usageCalls: 0, costCalls: 0, sessions: 0, activeDays: 0, toolCalls: 0 };
}

function summarize(calls: UsageCall[]): UsageTotals {
  const totals = emptyTotals();
  const sessions = new Set<string>();
  const days = new Set<string>();
  for (const call of calls) {
    totals.input += call.input;
    totals.output += call.output;
    totals.cacheRead += call.cacheRead;
    totals.cacheWrite += call.cacheWrite;
    totals.total += call.input + call.output + call.cacheRead + call.cacheWrite;
    totals.calls += 1;
    totals.toolCalls += call.toolCalls;
    if (call.usageKnown) totals.usageCalls += 1;
    if (call.cost !== null) {
      totals.cost += call.cost;
      totals.costCalls += 1;
    }
    sessions.add(call.sessionId);
    days.add(call.date);
  }
  totals.sessions = sessions.size;
  totals.activeDays = days.size;
  const inputClassTokens = totals.input + totals.cacheRead + totals.cacheWrite;
  return { ...totals, cacheHitRate: inputClassTokens > 0 ? totals.cacheRead / inputClassTokens : null };
}

function lastUsed(calls: UsageCall[]): string {
  return calls.reduce((latest, call) => Math.max(latest, call.timestamp), 0) ? new Date(calls.reduce((latest, call) => Math.max(latest, call.timestamp), 0)).toISOString() : "";
}

function collectCalls(sources: UsageSourceSession[]): UsageCall[] {
  const calls: UsageCall[] = [];
  for (const { info, entries } of sources) {
    const projectId = info.projectRoot || info.cwd;
    const projectName = basename(projectId) || projectId;
    for (const entry of entries) {
      const message = entry.message;
      if (message.role !== "assistant") continue;
      const assistant = message as AssistantMessage;
      const timestamp = parseTimestamp(entry.timestamp ?? assistant.timestamp, info.modified);
      if (!timestamp) continue;
      const usage = assistant.usage;
      const usageKnown = Boolean(usage && [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].some((value) => typeof value === "number" && Number.isFinite(value)));
      const recordedCost = usage?.cost && typeof usage.cost.total === "number" && Number.isFinite(usage.cost.total)
        ? usage.cost.total
        : null;
      calls.push({
        id: `${info.path}:${entry.id}`,
        sessionId: info.id,
        date: dateKey(timestamp),
        timestamp: timestamp.getTime(),
        projectId,
        projectName,
        provider: assistant.provider || "unknown",
        model: assistant.model || "unknown",
        input: numberOrZero(usage?.input),
        output: numberOrZero(usage?.output),
        cacheRead: numberOrZero(usage?.cacheRead),
        cacheWrite: numberOrZero(usage?.cacheWrite),
        cost: recordedCost,
        usageKnown,
        toolCalls: assistant.content.filter((content) => content.type === "toolCall").length,
      });
    }
  }
  return calls;
}

function sortByUsage<T extends UsageTotals>(items: T[]): T[] {
  return items.sort((left, right) => right.total - left.total || right.calls - left.calls);
}

function groupCalls(calls: UsageCall[], keyFor: (call: UsageCall) => string): Map<string, UsageCall[]> {
  const groups = new Map<string, UsageCall[]>();
  for (const call of calls) {
    const key = keyFor(call);
    const group = groups.get(key) ?? [];
    group.push(call);
    groups.set(key, group);
  }
  return groups;
}

function topGroup(calls: UsageCall[], keyFor: (call: UsageCall) => string): UsageCall[] | undefined {
  return [...groupCalls(calls, keyFor).values()]
    .sort((left, right) => summarize(right).total - summarize(left).total || right.length - left.length)[0];
}

function summarizeDays(calls: UsageCall[]): UsageDay[] {
  const dayGroups = groupCalls(calls, (call) => call.date);
  return [...dayGroups.entries()].map(([date, group]) => {
    const project = topGroup(group, (call) => call.projectId);
    const model = topGroup(group, (call) => `${call.provider}\u0000${call.model}`);
    return {
      date,
      ...summarize(group),
      ...(project ? { topProject: project[0].projectName } : {}),
      ...(model ? { topModel: `${model[0].provider} · ${model[0].model}` } : {}),
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
}

export function aggregateUsageStatistics(sources: UsageSourceSession[], range: UsageRange): UsageStatistics {
  const cutoff = rangeStart(range);
  const allCalls = collectCalls(sources);
  const calls = allCalls.filter((call) => cutoff === null || call.timestamp >= cutoff);
  const projectGroups = new Map<string, UsageCall[]>();
  const providerGroups = new Map<string, UsageCall[]>();

  for (const call of calls) {
    const append = (groups: Map<string, UsageCall[]>, key: string) => {
      const group = groups.get(key) ?? [];
      group.push(call);
      groups.set(key, group);
    };
    append(projectGroups, call.projectId);
    append(providerGroups, call.provider);
  }

  const activityCutoff = rangeStart("12m") ?? 0;
  const days = summarizeDays(allCalls.filter((call) => call.timestamp >= activityCutoff));
  const trendDays = summarizeDays(calls);

  const projects = sortByUsage([...projectGroups.entries()].map(([id, group]) => {
    const models = sortByUsage([...groupCalls(group, (call) => `${call.provider}\u0000${call.model}`).entries()].map(([key, modelCalls]) => {
      const [provider, model] = key.split("\u0000");
      return { provider, model, lastUsed: lastUsed(modelCalls), ...summarize(modelCalls) };
    }));
    return { id, name: group[0].projectName, lastUsed: lastUsed(group), models, ...summarize(group) };
  }));

  const providers = sortByUsage([...providerGroups.entries()].map(([provider, group]) => {
    const models = sortByUsage([...groupCalls(group, (call) => call.model).entries()].map(([model, modelCalls]) => ({ provider, model, lastUsed: lastUsed(modelCalls), ...summarize(modelCalls) })));
    return { provider, lastUsed: lastUsed(group), models, ...summarize(group) };
  }));

  return { range, generatedAt: new Date().toISOString(), totals: summarize(calls), days, trendDays, projects, providers };
}

function getCache(): Map<string, { fingerprint: string; createdAt: number; data: UsageStatistics }> {
  if (!globalThis.__piUsageStatisticsCache) globalThis.__piUsageStatisticsCache = new Map();
  return globalThis.__piUsageStatisticsCache;
}

export async function loadUsageStatistics(range: UsageRange, refresh = false): Promise<UsageStatistics> {
  const sessions = await listAllSessions({ force: refresh });
  const fingerprint = sessions.map((session) => `${session.id}:${session.modified}`).sort().join("|");
  const cache = getCache();
  const cached = cache.get(range);
  if (!refresh && cached && cached.fingerprint === fingerprint && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.data;

  const sources: UsageSourceSession[] = [];
  for (const info of sessions) {
    try {
      const entries = getSessionEntries(info.path).filter((entry): entry is SessionMessageEntry => entry.type === "message");
      sources.push({ info, entries });
    } catch {
      // A session can be removed or rewritten while its index entry is being read.
    }
  }
  const data = aggregateUsageStatistics(sources, range);
  cache.set(range, { fingerprint, createdAt: Date.now(), data });
  return data;
}

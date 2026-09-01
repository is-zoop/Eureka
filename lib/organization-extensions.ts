import "server-only";

import { getAuthConfig } from "@/lib/auth/config";
import { hasMarketplaceAccess, refreshMarketplaceSession } from "@/lib/auth/marketplace";
import type { AuthSession } from "@/lib/auth/types";

export type OrganizationExtensionType = "skill" | "mcp";

export type OrganizationExtension = {
  id: string;
  name: string;
  type: "Skill" | "MCP";
  description: string;
  author: string;
  department: string | null;
  categoryId: number | null;
  category: string | null;
  tags: string[];
  calls: number;
  isFavorite: boolean;
  updatedAt: string | null;
  version: string;
  connectType: string | null;
  versionHistory: OrganizationExtensionVersion[];
  iconUrl: string | null;
};

export type OrganizationExtensionVersion = { version: string; createdAt: string; changelog: string | string[] | null };
export type OrganizationExtensionContent = { fileName: string; basePath: string; content: string | null };

export type OrganizationExtensionCategory = { id: number; name: string };

type HazeCapability = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  description?: unknown;
  author?: unknown;
  department?: unknown;
  category_id?: unknown;
  category?: unknown;
  tags?: unknown;
  calls?: unknown;
  is_favorite?: unknown;
  updated_at?: unknown;
  version?: unknown;
  connect_type?: unknown;
  version_history?: unknown;
  icon?: unknown;
};

type HazeMarketPage = { items?: unknown; page?: unknown; page_size?: unknown; total?: unknown };

export class OrganizationExtensionsError extends Error {
  constructor(public readonly kind: "unauthenticated" | "forbidden" | "unavailable") {
    super(kind);
  }
}

export type HazeMarketplaceSession = { accessToken: string; session: AuthSession };

export async function getHazeMarketplaceSession(): Promise<HazeMarketplaceSession> {
  // The encrypted Eureka cookie deliberately omits access tokens, so every
  // marketplace proxy request refreshes a short-lived token server-side. The
  // shared auth helper deduplicates concurrent refreshes from profile, list,
  // and icon requests so rotating Haze refresh tokens do not race each other.
  const refreshed = await refreshMarketplaceSession(true);
  if (!refreshed?.session.accessToken) throw new OrganizationExtensionsError("unauthenticated");
  if (!hasMarketplaceAccess(refreshed.session)) throw new OrganizationExtensionsError("forbidden");
  return { accessToken: refreshed.session.accessToken, session: refreshed.session };
}

function getMarketplaceBaseUrl() {
  const config = getAuthConfig();
  if (!config) throw new OrganizationExtensionsError("unavailable");
  return config.issuer;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown) {
  const text = stringValue(value).trim();
  return text || null;
}

function mapCapability(item: HazeCapability): OrganizationExtension | null {
  const id = stringValue(item.id);
  const name = stringValue(item.name).trim();
  if (!/^\d+$/.test(id) || !name) return null;
  const type = item.type === "MCP" ? "MCP" : "Skill";
  const hasIcon = typeof item.icon === "string" && item.icon.startsWith("/");
  return {
    id,
    name,
    type,
    description: stringValue(item.description).trim(),
    author: stringValue(item.author).trim(),
    department: optionalString(item.department),
    categoryId: typeof item.category_id === "number" && Number.isInteger(item.category_id) ? item.category_id : null,
    category: optionalString(item.category),
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).slice(0, 4) : [],
    calls: typeof item.calls === "number" && Number.isFinite(item.calls) ? item.calls : 0,
    isFavorite: item.is_favorite === true,
    updatedAt: optionalString(item.updated_at),
    version: stringValue(item.version).trim(),
    connectType: optionalString(item.connect_type),
    versionHistory: Array.isArray(item.version_history) ? item.version_history.flatMap((record): OrganizationExtensionVersion[] => {
      const value = record as { version?: unknown; created_at?: unknown; changelog?: unknown };
      const version = stringValue(value.version).trim();
      const createdAt = stringValue(value.created_at).trim();
      const changelog = typeof value.changelog === "string" || Array.isArray(value.changelog) && value.changelog.every((entry) => typeof entry === "string") ? value.changelog : null;
      return version ? [{ version, createdAt, changelog }] : [];
    }) : [],
    iconUrl: hasIcon ? `/api/organization-extensions/${encodeURIComponent(id)}/icon` : null,
  };
}

async function fetchPage(type: OrganizationExtensionType, page: number, accessToken: string): Promise<{ items: OrganizationExtension[]; total: number }> {
  const query = new URLSearchParams({ page: String(page), page_size: "200", type });
  let response: Response;
  try {
    response = await fetch(`${getMarketplaceBaseUrl()}/api/marketplace/capabilities?${query}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new OrganizationExtensionsError("unavailable");
  }
  if (response.status === 401) throw new OrganizationExtensionsError("unauthenticated");
  if (response.status === 403) throw new OrganizationExtensionsError("forbidden");
  if (!response.ok) throw new OrganizationExtensionsError("unavailable");
  const payload = await response.json().catch(() => null) as { data?: HazeMarketPage } | null;
  const data = payload?.data;
  if (!data || !Array.isArray(data.items) || typeof data.total !== "number") throw new OrganizationExtensionsError("unavailable");
  return { items: data.items.map((item) => mapCapability(item as HazeCapability)).filter((item): item is OrganizationExtension => Boolean(item)), total: data.total };
}

export async function listOrganizationExtensions(type: OrganizationExtensionType, accessToken: string): Promise<OrganizationExtension[]> {
  const items: OrganizationExtension[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await fetchPage(type, page, accessToken);
    items.push(...result.items);
    total = result.total;
    page += 1;
  } while (page <= Math.ceil(total / 200));
  return items;
}

export async function listOrganizationExtensionCategories(accessToken: string): Promise<OrganizationExtensionCategory[]> {
  let response: Response;
  try {
    response = await fetch(`${getMarketplaceBaseUrl()}/api/business-categories`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new OrganizationExtensionsError("unavailable");
  }
  if (response.status === 401) throw new OrganizationExtensionsError("unauthenticated");
  if (response.status === 403) throw new OrganizationExtensionsError("forbidden");
  if (!response.ok) throw new OrganizationExtensionsError("unavailable");
  const payload = await response.json().catch(() => null) as { data?: unknown } | null;
  if (!Array.isArray(payload?.data)) throw new OrganizationExtensionsError("unavailable");
  return payload.data.flatMap((item): OrganizationExtensionCategory[] => {
    const value = item as { id?: unknown; name?: unknown };
    return typeof value.id === "number" && Number.isInteger(value.id) && typeof value.name === "string" && value.name.trim()
      ? [{ id: value.id, name: value.name.trim() }]
      : [];
  });
}

export async function fetchOrganizationExtensionIcon(id: string, accessToken: string): Promise<Response> {
  if (!/^\d+$/.test(id)) throw new OrganizationExtensionsError("unavailable");
  let response: Response;
  try {
    response = await fetch(`${getMarketplaceBaseUrl()}/api/marketplace/capabilities/${encodeURIComponent(id)}/icon`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    throw new OrganizationExtensionsError("unavailable");
  }
  if (response.status === 401) throw new OrganizationExtensionsError("unauthenticated");
  if (response.status === 403) throw new OrganizationExtensionsError("forbidden");
  if (!response.ok) throw new OrganizationExtensionsError("unavailable");
  return response;
}

function assertExtensionId(id: string) {
  if (!/^\d+$/.test(id)) throw new OrganizationExtensionsError("unavailable");
}

async function fetchHazeResponse(path: string, accessToken: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${getMarketplaceBaseUrl()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new OrganizationExtensionsError("unavailable");
  }
  if (response.status === 401) throw new OrganizationExtensionsError("unauthenticated");
  if (response.status === 403) throw new OrganizationExtensionsError("forbidden");
  if (!response.ok) throw new OrganizationExtensionsError("unavailable");
  return response;
}

export async function fetchOrganizationExtensionContent(id: string, file: "quick_start.md" | "README.md", accessToken: string): Promise<OrganizationExtensionContent> {
  assertExtensionId(id);
  const response = await fetchHazeResponse(`/api/marketplace/capabilities/${encodeURIComponent(id)}/content?${new URLSearchParams({ file })}`, accessToken);
  const payload = await response.json().catch(() => null) as { data?: { file_name?: unknown; base_path?: unknown; content?: unknown } } | null;
  const data = payload?.data;
  if (!data) throw new OrganizationExtensionsError("unavailable");
  return { fileName: stringValue(data.file_name), basePath: stringValue(data.base_path), content: typeof data.content === "string" ? data.content : null };
}

export async function toggleOrganizationExtensionFavorite(id: string, accessToken: string) {
  assertExtensionId(id);
  const response = await fetchHazeResponse(`/api/marketplace/capabilities/${encodeURIComponent(id)}/favorite`, accessToken, { method: "POST" });
  const payload = await response.json().catch(() => null) as { data?: { is_favorite?: unknown } } | null;
  if (typeof payload?.data?.is_favorite !== "boolean") throw new OrganizationExtensionsError("unavailable");
  return payload.data.is_favorite;
}

export async function fetchOrganizationExtensionDocumentationAsset(id: string, assetPath: string, accessToken: string) {
  assertExtensionId(id);
  if (!assetPath || assetPath.split("/").some((part) => !part || part === "." || part === "..")) throw new OrganizationExtensionsError("unavailable");
  return fetchHazeResponse(`/api/marketplace/capabilities/${encodeURIComponent(id)}/documentation/${assetPath.split("/").map(encodeURIComponent).join("/")}`, accessToken, { headers: { Accept: "*/*" } });
}

import { NextResponse } from "next/server";
import type { AppUpdateResponse } from "@/lib/api-types";
import { APP_LATEST_RELEASE_API, APP_REPOSITORY_URL, APP_VERSION, getEurekaReleaseUrl, isNewerStableVersion } from "@/lib/app-update";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

interface AppUpdateCache {
  value?: AppUpdateResponse;
  expiresAt: number;
  inFlight?: Promise<AppUpdateResponse>;
}

declare global {
  var __eurekaAppUpdateCache: AppUpdateCache | undefined;
}

function getCache(): AppUpdateCache {
  return globalThis.__eurekaAppUpdateCache ??= { expiresAt: 0 };
}

async function fetchLatestVersion(): Promise<AppUpdateResponse> {
  const response = await fetch(APP_LATEST_RELEASE_API, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // A new release repository has no latest release yet.
  if (response.status === 404) {
    return { currentVersion: APP_VERSION, latestVersion: APP_VERSION, updateAvailable: false, releaseUrl: `${APP_REPOSITORY_URL}/releases` };
  }
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`);

  const body = await response.json() as { tag_name?: unknown; draft?: boolean; prerelease?: boolean };
  const latestVersion = typeof body.tag_name === "string" ? body.tag_name.replace(/^v/, "") : "";
  const releaseUrl = getEurekaReleaseUrl(latestVersion);
  if (!releaseUrl || body.draft || body.prerelease) throw new Error("GitHub Releases returned an invalid stable release");

  return {
    currentVersion: APP_VERSION,
    latestVersion,
    updateAvailable: isNewerStableVersion(latestVersion, APP_VERSION),
    releaseUrl,
  };
}

async function loadUpdateStatus(): Promise<AppUpdateResponse> {
  const cache = getCache();
  if (cache.value && cache.expiresAt > Date.now()) return cache.value;
  if (!cache.inFlight) {
    cache.inFlight = fetchLatestVersion().then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + CACHE_TTL_MS;
      return value;
    }).finally(() => {
      cache.inFlight = undefined;
    });
  }

  try {
    return await cache.inFlight;
  } catch (error) {
    if (cache.value) return cache.value;
    throw error;
  }
}

export async function GET() {
  try {
    return NextResponse.json(await loadUpdateStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}

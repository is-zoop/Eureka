"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SubscriptionQuotas } from "@/features/settings/shared/subscription-quotas";

type QuotaStatus = "loading" | "ready" | "error";
type PreviewSnapshot = { data: SubscriptionQuotas | null; status: QuotaStatus };

const quotaPath = "/api/subscription-quotas";
const previewFreshMs = 60_000;
const previewMaxAgeMs = 5 * 60_000;
const previewRetryMs = 10_000;
const emptyPreview: PreviewSnapshot = { data: null, status: "loading" };
const previewListeners = new Set<() => void>();
let preview = emptyPreview;
let previewUpdatedAt = 0;
let previewRefreshAfter = 0;
let previewGeneration = 0;
let previewRequest: AbortController | null = null;

function publishPreview(snapshot: PreviewSnapshot) {
  preview = snapshot;
  previewListeners.forEach((listener) => listener());
}

function savePreview(quotas: SubscriptionQuotas) {
  // Only keep the fields displayed in the avatar menu, even after a full settings read.
  const data = { accounts: quotas.accounts.map(({ id, name, plan, status, windows, resets }) => ({
    id, name, plan, status, windows,
    ...(resets && { resets: { available: resets.available, nextExpiry: resets.nextExpiry } }),
  })) };
  previewUpdatedAt = Date.now();
  previewRefreshAfter = previewUpdatedAt + previewFreshMs;
  publishPreview({ data, status: "ready" });
}

export function invalidateSubscriptionQuotaPreview() {
  previewGeneration++;
  previewRequest?.abort();
  previewRequest = null;
  previewUpdatedAt = 0;
  previewRefreshAfter = 0;
  publishPreview(emptyPreview);
}

export async function prefetchSubscriptionQuotaPreview() {
  const now = Date.now();
  if (previewRequest || now < previewRefreshAfter) return;
  const controller = new AbortController();
  const previous = now - previewUpdatedAt < previewMaxAgeMs ? preview.data : null;
  previewRequest = controller;
  publishPreview({ data: previous, status: "loading" });
  try {
    const response = await fetch(`${quotaPath}?preview=1`, { cache: "no-store", signal: controller.signal });
    if (response.ok) {
      const data = await response.json() as SubscriptionQuotas;
      if (!controller.signal.aborted) savePreview(data);
    } else if (response.status === 401 || response.status === 403) {
      if (!controller.signal.aborted) {
        previewUpdatedAt = 0;
        previewRefreshAfter = Date.now() + previewRetryMs;
        publishPreview({ data: null, status: "error" });
      }
    } else {
      throw new Error("Subscription quota preview unavailable");
    }
  } catch {
    if (!controller.signal.aborted) {
      previewRefreshAfter = Date.now() + previewRetryMs;
      publishPreview({ data: previous, status: "error" });
    }
  } finally {
    if (previewRequest === controller) previewRequest = null;
  }
}

function subscribeToPreview(listener: () => void) {
  previewListeners.add(listener);
  return () => { previewListeners.delete(listener); };
}

export function useSubscriptionQuotaPreview() {
  return useSyncExternalStore(subscribeToPreview, () => preview, () => emptyPreview);
}

export function useSubscriptionQuotas(enabled: boolean) {
  const [data, setData] = useState<SubscriptionQuotas | null>(null);
  const [status, setStatus] = useState<QuotaStatus>("loading");
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    const generation = previewGeneration;
    request.current = controller;
    setStatus("loading");
    try {
      const response = await fetch(quotaPath, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Subscription quotas unavailable");
      const quotas = await response.json() as SubscriptionQuotas;
      if (!controller.signal.aborted) {
        setData(quotas);
        setStatus("ready");
        if (generation === previewGeneration) {
          previewRequest?.abort();
          previewRequest = null;
          savePreview(quotas);
        }
      }
    } catch {
      if (!controller.signal.aborted) setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    return () => request.current?.abort();
  }, [enabled, refresh]);

  return { data, status, refresh };
}

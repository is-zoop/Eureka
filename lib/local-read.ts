export function isTransientLocalReadError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  });
}

/** GET-only recovery for local status/metadata, never for prompts or mutations. */
export async function fetchLocalRead(url: string, options: { signal?: AbortSignal; timeoutMs: number }): Promise<Response> {
  if (!url.startsWith("/api/")) throw new Error("Local reads require an application API path");
  const timeout = process.env.NODE_ENV === "development" ? Math.max(45_000, options.timeoutMs) : options.timeoutMs;
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const deadline = AbortSignal.timeout(timeout);
      const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
      const response = await fetch(url, { method: "GET", cache: "no-store", signal });
      if (attempt === 1 || ![502, 503, 504].includes(response.status)) return response;
      await response.body?.cancel();
    } catch (error) {
      options.signal?.throwIfAborted();
      if (attempt === 1 || !isTransientLocalReadError(error)) throw error;
    }
    await wait(300, options.signal);
  }
  throw new Error("Local read did not finish");
}

type PendingLogin = { requestId: string; claimToken: string; browserUrl: string; expiresAt: number };

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Login cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 1500);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Browser and desktop cookie stores differ; claim the result in the desktop. */
export async function loginInBrowser({
  returnTo,
  openBrowser,
  signal,
  onWaiting,
  request = fetch,
  wait = waitForPoll,
}: {
  returnTo: string;
  openBrowser: (url: string) => Promise<unknown>;
  signal: AbortSignal;
  onWaiting: () => void;
  request?: typeof fetch;
  wait?: (signal: AbortSignal) => Promise<void>;
}): Promise<string> {
  const endpoint = "/api/marketplace-auth/desktop";
  const post = (body: unknown, requestSignal?: AbortSignal) => request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    signal: requestSignal,
  });
  signal.throwIfAborted();
  // Drain cookie-writing requests before cancellation completes. Aborting a
  // fetch does not stop its server handler or prevent a late Set-Cookie.
  const start = await post({ action: "start", returnTo }, AbortSignal.timeout(15000));
  if (!start.ok) throw new Error("无法启动浏览器授权，请稍后重试。");
  const pending = await start.json() as PendingLogin;
  let complete = false;
  try {
    signal.throwIfAborted();
    await openBrowser(pending.browserUrl);
    signal.throwIfAborted();
    onWaiting();
    while (Date.now() < pending.expiresAt) {
      await wait(signal);
      signal.throwIfAborted();
      const response = await post({ action: "poll", requestId: pending.requestId, claimToken: pending.claimToken }, AbortSignal.timeout(15000));
      signal.throwIfAborted();
      if (response.status === 410) throw new Error("授权等待已过期，请重新登录。");
      if (!response.ok) throw new Error("无法获取授权结果，请重新登录。");
      const result = await response.json() as { status: string; returnTo?: string };
      signal.throwIfAborted();
      if (result.status === "failed") throw new Error("Haze 授权未完成，请重新登录。");
      if (result.status === "complete") {
        complete = true;
        return result.returnTo ?? "/";
      }
    }
    throw new Error("授权等待已过期，请重新登录。");
  } finally {
    if (!complete) {
      // Cancellation uses a fresh request because the polling signal may be aborted.
      await post({ action: "cancel", requestId: pending.requestId, claimToken: pending.claimToken }, AbortSignal.timeout(3000)).catch(() => {});
    }
  }
}

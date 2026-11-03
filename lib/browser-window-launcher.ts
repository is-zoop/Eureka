import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Browser, BrowserContext } from "playwright";

export interface NativeBrowserWindow {
  debugPortMode: "explicit";
  browser: Browser;
  context: BrowserContext;
  close: () => Promise<void>;
}

async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("No local port")); return; }
      server.close(error => error ? reject(error) : done(address.port));
    });
  });
}

// Launch only our own browser with a new disposable profile. Never attach to a
// user's everyday browser or expose a debugging endpoint to other machines.
export async function launchBrowserWindow(executablePath: string, options?: { minimized?: boolean }): Promise<NativeBrowserWindow> {
  const port = await allocateLoopbackPort();
  const profile = await mkdtemp(join(tmpdir(), "eureka-browser-window-"));
  const child = spawn(executablePath, [
    `--user-data-dir=${profile}`, "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check",
    ...(options?.minimized ? ["--start-minimized"] : []), "about:blank",
  ], { shell: false, stdio: ["ignore", "ignore", "pipe"], windowsHide: false });
  // Trust only the websocket endpoint printed by our own child. A different
  // process winning the port allocation race must never be attached instead.
  let endpoint: string | undefined;
  let launchOutput = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    if (endpoint) return;
    launchOutput = (launchOutput + chunk).slice(-8192);
    const match = launchOutput.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/[a-zA-Z0-9-]+)/);
    if (match && Number(match[2]) === port) { endpoint = match[1]; launchOutput = ""; }
  });
  let launchFailed = false;
  child.on("error", () => { launchFailed = true; });
  let browser: Browser | undefined;
  let closing: Promise<void> | undefined;
  const killOwnedChild = () => { if (child.exitCode === null && child.signalCode === null) child.kill(); };
  process.once("exit", killOwnedChild);
  const close = () => closing ??= (async () => {
    if (browser?.isConnected()) {
      const cdp = await browser.newBrowserCDPSession().catch(() => null);
      await cdp?.send("Browser.close").catch(() => {});
      await browser.close().catch(() => {});
    }
    for (let n = 0; n < 30 && child.exitCode === null && child.signalCode === null; n++) await new Promise(r => setTimeout(r, 100));
    killOwnedChild();
    process.removeListener("exit", killOwnedChild);
    // The delete target must be the exact disposable directory we created.
    if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith("eureka-browser-window-")) throw new Error("浏览器临时目录无效");
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  })();
  try {
    const deadline = Date.now() + 25_000;
    while (!endpoint && Date.now() < deadline) {
      if (launchFailed || child.exitCode !== null || child.signalCode !== null) throw new Error("浏览器窗口启动失败");
      await new Promise(r => setTimeout(r, 100));
    }
    if (!endpoint) throw new Error("浏览器窗口启动超时");
    const { chromium } = await import("playwright");
    browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error("浏览器会话不可用");
    return { browser, context, close, debugPortMode: "explicit" };
  } catch {
    await close().catch(() => {});
    throw new Error("浏览器窗口启动失败，请检查本机桌面环境");
  }
}

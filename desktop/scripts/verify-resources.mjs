import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import { withoutSigningSecrets } from "./runtime-config.mjs";

async function unusedLocalPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

/** Verify the actual packaged server without logging in or running a task. */
export async function verifyStandaloneResources(appDirectory, nodeExecutable, timeoutMs = 30000) {
  const port = await unusedLocalPort();
  const child = spawn(nodeExecutable, ["server.js"], {
    cwd: appDirectory, windowsHide: true,
    env: { ...withoutSigningSecrets(process.env), EUREKA_AUTH_SESSION_SECRET: randomBytes(32).toString("hex"), NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), PI_WEB_NO_OPEN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", startupError;
  const collect = data => { output = (output + data.toString()).slice(-12000); };
  child.stdout.on("data", collect); child.stderr.on("data", collect);
  child.on("error", error => { startupError = error; });
  const closed = new Promise(resolve => child.once("close", resolve));
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + timeoutMs;
    let login;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Packaged server exited before it was ready.");
      try { login = await fetch(`${base}/login`, { redirect: "manual", signal: AbortSignal.timeout(Math.min(timeoutMs, 3000)) }); break; }
      catch { await delay(100); }
    }
    if (!login) throw new Error("Packaged server startup timed out.");
    await login.arrayBuffer();
    if (login.status !== 200) throw new Error(`Packaged login page returned HTTP ${login.status}.`);
    const root = await fetch(base, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    await root.arrayBuffer();
    if (![200, 307, 308].includes(root.status)) throw new Error(`Packaged homepage returned HTTP ${root.status}.`);
  } catch (error) {
    throw new Error(`Desktop resource verification failed: ${error.message}\n${output}`, { cause: error });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}

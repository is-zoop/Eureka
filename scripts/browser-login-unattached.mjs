import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Diagnostic only: start the same executable/settings without connecting any
// browser-control client. Importing Playwright below only locates its binary.
let profile;
try {
  let executable = process.env.EUREKA_BROWSER_EXECUTABLE;
  const root = resolve(import.meta.dirname, "..");
  const descriptor = join(root, "browser", "runtime.json");
  if (!executable && existsSync(descriptor)) executable = resolve(root, "browser", JSON.parse(await readFile(descriptor, "utf8")).executable);
  if (!executable) { const { chromium } = await import("playwright"); executable = chromium.executablePath(); }
  if (!existsSync(executable)) throw new Error("missing browser");
  profile = await mkdtemp(join(tmpdir(), "eureka-unattached-check-"));
  console.log("正在打开旧参数对照窗口（保留 --remote-debugging-port=0）。本次不会连接控制工具。");
  console.log("请手动登录并测试验证码，记录能否通过；测试后关闭该浏览器的全部窗口。");
  console.log("这个命令窗口会等待浏览器退出，然后清理本次临时资料。");
  const child = spawn(executable, [
    `--user-data-dir=${profile}`, "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
    "https://myseller.taobao.com/home.htm/SellManage/on_sale?current=1&pageSize=20&queryItemId=",
  ], { shell: false, stdio: "ignore", windowsHide: false });
  await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
} catch {
  console.error("测试浏览器未能正常启动或退出。请确认本机已安装 Eureka 配套浏览器。");
  process.exitCode = 1;
} finally {
  if (profile) {
    if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith("eureka-unattached-check-")) throw new Error("Invalid diagnostic directory");
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 })
      .then(() => console.log("本次测试临时资料已清理。"))
      .catch(() => { console.error("临时资料尚未清理完成，请先关闭本次测试浏览器的全部窗口。目录：", profile); process.exitCode = 1; });
  }
}

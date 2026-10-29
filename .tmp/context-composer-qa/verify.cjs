const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ channel: "chromium", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
  let sessionCommandCalls = 0;
  await page.route("**/api/agent/*", async (route) => {
    if (route.request().method() === "POST") {
      const command = route.request().postDataJSON();
      if (command.type === "get_tools" || command.type === "get_commands") {
        await route.fulfill({ json: { success: true, data: command.type === "get_tools" ? [] : { commands: [] } } });
        return;
      }
      if (command.type !== "get_session_stats") throw new Error(`Unexpected mutating command: ${command.type}`);
      sessionCommandCalls++;
      await route.fulfill({ json: { success: true, data: { sessionId: "01a0d29b-081b-7b0c-b651-881d38e9d6ad", totalMessages: 1, userMessages: 1, assistantMessages: 0, toolCalls: 0, toolResults: 0, tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 }, cost: 0 } } });
    } else await route.continue();
  });
  try {
    await page.goto("http://127.0.0.1:8080/?session=01a0d29b-081b-7b0c-b651-881d38e9d6ad", { waitUntil: "domcontentloaded", timeout: 60000 });
    const trigger = page.locator("[data-context-trigger]");
    const skipLogin = page.getByRole("button", { name: "跳过登录", exact: true });
    await trigger.or(skipLogin).first().waitFor({ state: "visible", timeout: 60000 });
    if (await skipLogin.isVisible()) await skipLogin.click();
    await trigger.waitFor({ state: "visible", timeout: 60000 });
    for (const width of [1280, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width <= 640) await page.locator("[data-mobile-toolbar]").waitFor();
      const positions = await page.locator("[data-composer-actions]").evaluate((element) => {
        const trigger = element.querySelector("[data-context-trigger]");
        const send = Array.from(element.querySelectorAll("button")).find((item) => item !== trigger);
        const t = trigger.getBoundingClientRect(), s = send.getBoundingClientRect();
        return { count: document.querySelectorAll("[data-context-trigger]").length, trigger: t.toJSON(), send: s.toJSON(), viewport: window.innerWidth };
      });
      assert.equal(positions.count, 1);
      assert.ok(positions.trigger.left >= 0 && positions.send.right <= width, `${width}px actions fit`);
      assert.ok(positions.trigger.right <= positions.send.left, `${width}px actions do not overlap`);
      await trigger.click();
      const popup = page.locator("[data-context-popup]");
      await popup.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const element = document.querySelector("[data-context-popup]");
        return element && getComputedStyle(element).opacity === "1" && !element.hasAttribute("data-starting-style");
      });
      await page.waitForFunction(() => !Array.from(document.querySelector("[data-context-popup]")?.querySelectorAll('[role="status"]') ?? []).some((element) => element.textContent.includes("正在读取上下文")));
      const bounds = await popup.evaluate((element) => ({ rect: element.getBoundingClientRect().toJSON(), scrolls: element.scrollHeight > element.clientHeight, topOfTrigger: document.querySelector("[data-context-trigger]").getBoundingClientRect().top }));
      assert.ok(bounds.rect.left >= 10 && bounds.rect.right <= width - 10, `${width}px popup stays in viewport`);
      assert.ok(bounds.rect.bottom <= bounds.topOfTrigger, `${width}px popup opens above input`);
      assert.ok(bounds.scrolls);
      await page.screenshot({ path: path.join(__dirname, `${width}px.png`) });
      await page.keyboard.press("Escape");
      await popup.waitFor({ state: "hidden" });
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-context-trigger")), true);
    }
    // Keep the existing read-only slash command anchored to the same trigger.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("textarea").fill("/session");
    await page.locator("[data-composer-actions]").getByRole("button", { name: "发送", exact: true }).click();
    await page.locator("[data-context-popup]").waitFor({ state: "visible" });
    assert.equal(sessionCommandCalls, 1);
    const anchor = await page.locator("[data-context-popup]").evaluate((element) => ({ bottom: element.getBoundingClientRect().bottom, triggerTop: document.querySelector("[data-context-trigger]").getBoundingClientRect().top }));
    assert.ok(anchor.bottom <= anchor.triggerTop);
    assert.deepEqual(errors, []);
    console.log("PASS: real dev assets; 1280/375/320px; one composer trigger; no action overlap; upward popup; internal scroll; Escape focus return; /session programmatic anchoring; no browser errors.");
    fs.writeFileSync(path.join(__dirname, "result.json"), JSON.stringify({ passed: true, errors }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

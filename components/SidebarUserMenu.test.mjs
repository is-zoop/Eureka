import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { SidebarUserMenu } = await jiti.import("./SidebarUserMenu.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

test("sidebar user menu uses shadcn sidebar and dropdown primitives", () => {
  const menu = readFileSync("components/SidebarUserMenu.tsx", "utf8");
  const shell = readFileSync("components/AppShell.tsx", "utf8");
  assert.match(menu, /SidebarFooter/);
  assert.match(menu, /DropdownMenuContent side="top"/);
  assert.match(menu, /account\.settings/);
  assert.match(menu, /account\.logout/);
  assert.match(menu, /marketplace-auth\/logout/);
  assert.match(shell, /SidebarUserMenu\s+user=\{authenticatedUser\}/);
});

test("a guest always gets a default avatar and guest identity rather than stale profile data", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(SidebarUserMenu, {
    guest: true, user: { name: "Previous user", email: "previous@example.test", avatarUrl: "https://previous.example.test/avatar.png" },
  })));
  assert.match(html, /aria-label="不愿意透露姓名的神秘用户"/);
  assert.match(html, /Not logged in/);
  assert.match(html, /src="\/icons\/guest-avatar\.png"/);
  assert.doesNotMatch(html, /Previous user|previous@example|previous\.example/);
});

test("authenticated accounts retain their display identity", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(SidebarUserMenu, {
    user: { name: "Test User", email: "test@example.test" },
  })));
  assert.match(html, /aria-label="Test User"/);
  assert.match(html, /test@example.test/);
  assert.doesNotMatch(html, /Not logged in/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sidebar user menu uses shadcn sidebar and dropdown primitives", () => {
  const menu = readFileSync("components/SidebarUserMenu.tsx", "utf8");
  const shell = readFileSync("components/AppShell.tsx", "utf8");
  assert.match(menu, /SidebarFooter/);
  assert.match(menu, /DropdownMenuContent side="top"/);
  assert.match(menu, /account\.settings/);
  assert.match(menu, /account\.logout/);
  assert.match(menu, /marketplace-auth\/logout/);
  assert.match(shell, /SidebarUserMenu user=\{authenticatedUser\}/);
});

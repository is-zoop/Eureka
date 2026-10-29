import assert from "node:assert/strict";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { createJiti } from "jiti";

const cssHook = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".module.css")) return { format: "module", source: "export default new Proxy({}, { get: (_, name) => String(name) });", shortCircuit: true };
    return nextLoad(url, context);
  },
});
after(() => cssHook.deregister());

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { buildSlashCommandLayout } = await jiti.import("./ChatInput.tsx");

test("uses the rendered slash command order for selection indices", () => {
  const dormant = {
    name: "skill:alpha",
    description: "Dormant skill",
    source: "skill",
  };
  const active = {
    name: "skill:beta",
    description: "Active skill",
    source: "skill",
  };
  const builtin = {
    name: "compact",
    description: "Compact",
    source: "builtin",
  };

  const layout = buildSlashCommandLayout(
    [dormant, active, builtin],
    { alpha: true, beta: false },
  );

  assert.deepEqual(
    layout.commands.map((command) => command.name),
    ["compact", "skill:beta", "skill:alpha"],
  );
  assert.deepEqual(
    layout.groups.flatMap((group) => group.items.map((item) => item.index)),
    [0, 1, 2],
  );
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack");
const source = await readFile(new URL("../instrumentation.ts", import.meta.url), "utf8");

for (const runtime of ["edge", "nodejs"]) {
  test(`instrumentation loads Node dependencies only in the Node build (${runtime})`, async (t) => {
    const cache = resolve(".cache");
    await mkdir(cache, { recursive: true });
    const directory = await mkdtemp(join(cache, "instrumentation-"));
    const originalCalls = globalThis.__eurekaInstrumentationFixtureCalls;
    t.after(async () => {
      if (originalCalls === undefined) delete globalThis.__eurekaInstrumentationFixtureCalls;
      else globalThis.__eurekaInstrumentationFixtureCalls = originalCalls;
      assert.equal(dirname(directory), cache);
      await rm(directory, { recursive: true, force: true });
    });
    await writeFile(join(directory, "entry.mjs"), ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText);
    // A real Node-only dependency makes an accidental Edge import fail exactly
    // as undici does, without loading providers or changing the HTTP dispatcher.
    await writeFile(join(directory, "node-only.mjs"), `
      import { Console } from "node:console";
      export function startAutomationScheduler() {}
      export function configureHttpDispatcher() {
        globalThis.__eurekaInstrumentationFixtureCalls++;
        return Console;
      }
    `);
    const compiler = webpack({
      mode: "development",
      target: runtime === "nodejs" ? "node" : "webworker",
      context: directory,
      entry: "./entry.mjs",
      devtool: false,
      output: { path: join(directory, "out"), filename: "entry.cjs", library: { type: "commonjs2" } },
      resolve: { alias: { "@/lib/http-dispatcher$": join(directory, "node-only.mjs"), "@/lib/automation-scheduler$": join(directory, "node-only.mjs") } },
      plugins: [new webpack.DefinePlugin({ "process.env.NEXT_RUNTIME": JSON.stringify(runtime) })],
    });
    const stats = await new Promise((resolveStats, reject) => {
      compiler.run((error, result) => {
        compiler.close(closeError => {
          if (error || closeError) reject(error || closeError);
          else resolveStats(result);
        });
      });
    });
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
    const nodeOnlyIncluded = [...stats.compilation.modules].some(module => module.resource === join(directory, "node-only.mjs"));
    assert.equal(nodeOnlyIncluded, runtime === "nodejs");
    globalThis.__eurekaInstrumentationFixtureCalls = 0;
    await require(join(directory, "out", "entry.cjs")).register();
    assert.equal(globalThis.__eurekaInstrumentationFixtureCalls, runtime === "nodejs" ? 1 : 0);
  });
}

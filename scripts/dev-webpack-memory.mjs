import { join } from "node:path";

/** Release obsolete compilation generations sooner. Production is unchanged. */
export function configureDevWebpackMemory(config, dev, root) {
  if (!dev) return config;
  if (root) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias["@/lib/app-fonts$"] = join(root, "lib", "dev-app-fonts.ts");
    config.resolve.alias[join(root, "lib", "app-fonts.ts")] = join(root, "lib", "dev-app-fonts.ts");
    config.resolve.alias[join(root, "node_modules", "next", "dist", "compiled", "mini-css-extract-plugin", "hmr", "hotModuleReplacement.js")] = join(root, "scripts", "dev-css-hot-reload.js");
  }
  for (const plugin of config.plugins ?? []) {
    if (plugin?.constructor?.name === "MemoryWithGcCachePlugin" && "maxGenerations" in plugin) plugin.maxGenerations = 1;
  }
  if (config.cache && config.cache.type === "filesystem") config.cache.allowCollectingMemory = true;
  if (process.env.EUREKA_DEV_MEMORY_REPORT === "1") {
    config.plugins ??= [];
    config.plugins.push({ apply(compiler) {
      compiler.hooks.done.tap("EurekaDevMemory", stats => {
        const memory = process.memoryUsage();
        console.log("[eureka:dev-memory] " + JSON.stringify({ compiler: compiler.name, modules: stats.compilation.modules.size,
          mermaidModules: [...stats.compilation.modules].filter(module => /[\\/]node_modules[\\/]mermaid[\\/]/.test(module.resource ?? "")).length,
          rssMB: Math.round(memory.rss / 1048576), heapMB: Math.round(memory.heapUsed / 1048576), buffersMB: Math.round(memory.arrayBuffers / 1048576) }));
      });
    } });
  }
  return config;
}

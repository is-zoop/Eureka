import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { desktopTraceExcludes } from "./desktop/scripts/standalone-resources.mjs";
import { prepareBrowserAssets } from "./scripts/browser-assets.mjs";
import { configureDevWebpackMemory } from "./scripts/dev-webpack-memory.mjs";

const configDir = dirname(fileURLToPath(import.meta.url));
const automationContract = JSON.parse(readFileSync(join(configDir, "features/automation/sdk/automation-sdk-contract.json"), "utf8"));
const APP_BROWSER_POST_MAX_BYTES = automationContract.limits.executionValueBytes + 64 * 1024;
const browserAssets = prepareBrowserAssets(configDir);
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  // The desktop packaging script opts in to a self-contained Node server.
  // Keep normal web development unchanged.
  ...(process.env.EUREKA_DESKTOP_BUILD === "1" ? { output: "standalone" } : {}),
  outputFileTracingRoot: configDir,
  outputFileTracingExcludes: { "*": desktopTraceExcludes },
  outputFileTracingIncludes: { "/api/subscription-quotas": ["./node_modules/@specode/pi-subscription-usage/**/*"] },
  // The proxy clones request bodies before route-level streaming limits apply.
  experimental: {
    proxyClientMaxBodySize: APP_BROWSER_POST_MAX_BYTES,
    webpackBuildWorker: true,
    optimizePackageImports: ["date-fns/locale", "es-toolkit", "react-day-picker"],
  },
  // Dev-only cache/font settings and safe stylesheet replacement on hot reload.
  webpack(config, { dev }) { return configureDevWebpackMemory(config, dev, configDir); },
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "undici",
    // Host-only table/schema libraries retain their standard Node module loading.
    "exceljs",
    "csv-parse",
    "csv-stringify",
    "ajv",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "jiti",
    "typebox",
  ],
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*"],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
    NEXT_PUBLIC_MERMAID_ASSET_URL: browserAssets.mermaidUrl,
  },
};

export default nextConfig;

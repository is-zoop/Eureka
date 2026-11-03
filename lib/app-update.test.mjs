import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { APP_VERSION, APP_REPOSITORY_URL, APP_LATEST_RELEASE_API, getEurekaReleaseUrl, isNewerStableVersion } = await jiti.import("./app-update.ts");

test("detects newer stable Eureka versions", () => {
  assert.equal(isNewerStableVersion("0.8.8", "0.8.7"), true);
  assert.equal(isNewerStableVersion("0.9.0", "0.8.7"), true);
  assert.equal(isNewerStableVersion("1.0.0", "0.9.9"), true);
});

test("does not report equal, older, or unsupported versions as updates", () => {
  assert.equal(isNewerStableVersion("0.8.7", "0.8.7"), false);
  assert.equal(isNewerStableVersion("0.8.6", "0.8.7"), false);
  assert.equal(isNewerStableVersion("0.8.8-beta.1", "0.8.7"), false);
  assert.equal(isNewerStableVersion("invalid", "0.8.7"), false);
});

test("builds a release-notes URL only for stable versions", () => {
  assert.equal(
    getEurekaReleaseUrl("0.8.8"),
    "https://github.com/is-zoop/Eureka/releases/tag/v0.8.8",
  );
  assert.equal(getEurekaReleaseUrl("0.8.8-beta.1"), null);
});

test("release identity and version come from the root package", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(APP_VERSION, pkg.version);
  assert.equal(APP_REPOSITORY_URL, "https://github.com/is-zoop/Eureka");
  assert.equal(APP_LATEST_RELEASE_API, "https://api.github.com/repos/is-zoop/Eureka/releases/latest");
});

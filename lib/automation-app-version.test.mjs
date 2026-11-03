// User-run regression sources; no application, browser or model execution.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { compareAppVersions, latestAppVersion } = await createJiti(import.meta.url).import("./automation-app-version.ts");
test("latest uses numeric version precedence and release/prerelease ordering", () => {
  assert.equal(latestAppVersion(["1.0.0", "1.9.0", "1.10.0", "1.10.0-rc.1"].map(version => ({version}))), "1.10.0");
  assert.ok(compareAppVersions("1.0.0-beta.10", "1.0.0-beta.2") > 0);
  assert.ok(compareAppVersions("2.0.0", "2.0.0-rc.1") > 0);
  assert.ok(compareAppVersions("1.0.0-alpha", "1.0.0-1") > 0);
  assert.ok(compareAppVersions("99999999999999999999.0.0", "99999999999999999998.0.0") > 0);
  assert.equal(compareAppVersions("1.0.0", "1.0.0"), 0);
});

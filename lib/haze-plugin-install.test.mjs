import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
import { fixtureZip, pluginFiles } from "./haze-plugin-fixture.mjs";
import { validatePluginCredentialRequest } from "./haze-plugin-auth.mjs";

test("organization plugin installation, identity approval and runtime resources", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "eureka-org-plugin-"));
  const cwd = join(root, "project"), agent = join(root, "agent");
  await mkdir(cwd); await mkdir(agent);
  const env = { PI_CODING_AGENT_DIR: agent, EUREKA_AUTH_HAZE_ISSUER: "https://haze.example", EUREKA_AUTH_CLIENT_ID: "test-client", EUREKA_AUTH_REDIRECT_URI: "http://localhost/callback", EUREKA_AUTH_SESSION_SECRET: "test-only-organization-plugin-secret-32" };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const previousFetch = globalThis.fetch;
  let archive = fixtureZip();
  globalThis.fetch = async (input) => String(input).endsWith("/access-prompt") ? Response.json({ data: { download_url: "https://haze.example/download/test" } }) : new Response(archive);
  t.after(async () => { globalThis.fetch = previousFetch; for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(root, { recursive: true, force: true }); });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
  const install = await jiti.import("./haze-plugin-install.ts");
  const registry = await jiti.import("./haze-registry.ts");
  const resources = await jiti.import("./haze-plugin-resources.ts");
  const session = { principal: { subject: "user-a", permissions: ["page.marketplace"] }, refreshToken: "test-only", providerId: "haze-oidc", expiresAt: Date.now() + 10000 };
  const input = { cwd, scope: "project", capabilityId: "42", name: "Atlas", version: "2.1.0", operation: "install", session, accessToken: "test-only" };
  let current;
  await t.test("preparation is presentation-safe and bound to scope, identity and bytes", async () => {
    const prepared = await install.prepareOrganizationPlugin(input);
    assert.equal(prepared.requiresApproval, true);
    assert.equal(JSON.stringify(prepared).includes(root.replaceAll("\\", "\\\\")), false);
    assert.deepEqual(prepared.servers.map((server) => server.url), ["https://atlas.example/api/mcp"]);
    const commit = { ...input, preparationToken: prepared.preparationToken, approveAddresses: true };
    await assert.rejects(install.commitOrganizationPlugin({ ...commit, session: { ...session, principal: { subject: "user-b" } } }), /身份/);
    await assert.rejects(install.commitOrganizationPlugin({ ...commit, version: "2.2.0" }), /版本/);
    await assert.rejects(install.commitOrganizationPlugin({ ...commit, approveAddresses: false }), /确认/);
    current = await install.commitOrganizationPlugin(commit);
    assert.equal(current.plugin.subject, "user-a");
    assert.equal(await readFile(join(current.plugin.root, "references", "current-rules.md"), "utf8"), pluginFiles()["references/current-rules.md"]);
    await assert.rejects(install.commitOrganizationPlugin(commit), /失效/);
  });
  await t.test("shared resolver loads both skills and diagnoses name conflicts", () => {
    const loaded = resources.applyOrganizationPluginSkills(cwd, { skills: [], diagnostics: [] });
    assert.deepEqual(loaded.skills.map((skill) => skill.name).sort(), ["atlas-ask", "atlas-menu"]);
    assert.ok(loaded.skills.every((skill) => skill.managedPlugin.capabilityId === "42"));
    const collision = resources.applyOrganizationPluginSkills(cwd, { skills: [loaded.skills[0]], diagnostics: [] });
    assert.equal(collision.skills.length, 2);
    assert.ok(collision.diagnostics.some((item) => item.message.includes("重名")));
  });
  await t.test("enterprise skill icons follow installed paths, including plugin children, rather than matching names", async () => {
    const { annotateOrganizationSkills } = await jiti.import("./haze-capability-presentation.ts");
    const before = registry.readHazeRegistry(cwd, "project");
    const enterpriseRoot = join(cwd, ".pi", "skills", "standalone");
    const localRoot = join(cwd, ".pi", "skills", "standalone-local");
    await mkdir(enterpriseRoot, { recursive: true }); await mkdir(localRoot, { recursive: true });
    const enterprisePath = join(enterpriseRoot, "SKILL.md"), localPath = join(localRoot, "SKILL.md");
    for (const path of [enterprisePath, localPath]) await writeFile(path, "---\nname: standalone\ndescription: Test\n---\nTest");
    await registry.writeHazeRegistry(cwd, "project", { ...before, installs: [...before.installs, {
      capabilityId: "88", name: "Enterprise skill", type: "Skill", version: "1.0.0", scope: "project", installedAt: new Date().toISOString(), skillPath: enterpriseRoot, disabled: true,
    }] });
    try {
      const loaded = resources.applyOrganizationPluginSkills(cwd, { skills: [], diagnostics: [] }).skills;
      const annotated = annotateOrganizationSkills(cwd, [...loaded, { name: "standalone", filePath: enterprisePath }, { name: "standalone", filePath: localPath }]);
      assert.ok(annotated.slice(0, 2).every((skill) => skill.organizationCapability.capabilityId === "42"));
      assert.deepEqual(annotated[2].organizationCapability, { capabilityId: "88", source: "https://haze.example" });
      assert.equal(annotated[3].organizationCapability, undefined);
      assert.equal(annotateOrganizationSkills(cwd, [{ name: "no-file" }])[0].organizationCapability, undefined);
      if (process.platform === "win32") assert.equal(annotateOrganizationSkills(cwd, [{ filePath: enterprisePath.toUpperCase().replaceAll("\\", "/") }])[0].organizationCapability.capabilityId, "88");
    } finally { await registry.writeHazeRegistry(cwd, "project", before); }
  });
  await t.test("repository-supplied plugin records require project trust before loading", async () => {
    const otherCwd = join(root, "untrusted-project");
    await mkdir(otherCwd);
    await registry.writeHazeRegistry(otherCwd, "project", { version: 1, installs: [{ ...current }] });
    const trust = await jiti.import("./project-trust.ts");
    assert.deepEqual(trust.getProjectTrustStatus(otherCwd, agent), { requiresTrust: true, trusted: false });
    const loaded = resources.applyOrganizationPluginSkills(otherCwd, { skills: [], diagnostics: [] });
    assert.equal(loaded.skills.length, 0);
    assert.ok(loaded.diagnostics.some((entry) => entry.message.includes("尚未受信任")));
    assert.equal(trust.getProjectTrustStatus(cwd, agent).trusted, true, "explicit installation records the project trust decision");
  });
  await t.test("runtime registers namespaced MCP once and releases registrations on reload and shutdown", async () => {
    const { installHazeManagedMcpRuntime } = await jiti.import("./haze-mcp-runtime.ts");
    const listeners = new Map(), active = new Map();
    let disposed = 0;
    const pi = {
      on(event, handler) {
        const previous = listeners.get(event);
        listeners.set(event, async (...args) => { await previous?.(...args); return handler(...args); });
      },
      events: { on() { return () => {}; }, emit(_event, request) {
        assert.equal(active.has(request.name), false, "duplicate runtime registration");
        active.set(request.name, request.definition);
        request.result = { ok: true, registration: { dispose() { active.delete(request.name); disposed++; } } };
      } },
    };
    await installHazeManagedMcpRuntime(pi);
    const context = { cwd, sessionManager: { getSessionId: () => "runtime-test-session" } };
    await listeners.get("session_start")({}, context);
    assert.equal(active.size, 1);
    const [name, definition] = [...active][0];
    assert.match(name, /^haze_[a-f0-9]{8}_42__atlas$/);
    assert.equal(definition.httpTransport, "streamable-http");
    assert.equal(definition.lifecycle, "lazy");
    assert.equal(definition.requestHeadersCommand.timeoutMs, 30_000);
    const guard = JSON.parse(Buffer.from(definition.requestHeadersCommand.args.at(-1), "base64url").toString());
    assert.deepEqual(guard, { source: "https://haze.example", subject: "user-a", url: "https://atlas.example/api/mcp" });
    assert.equal(resources.pluginPresentation(current, "runtime-test-session").state, "loaded");
    await listeners.get("session_start")({}, context);
    assert.equal(active.size, 1); assert.equal(disposed, 1);
    await listeners.get("session_shutdown")();
    assert.equal(active.size, 0); assert.equal(disposed, 2);
    assert.equal(resources.pluginPresentation(current, "runtime-test-session").state, "installed");
  });
  await t.test("same-address updates reuse approval and keep active directories until release", async () => {
    const oldRoot = current.plugin.root;
    resources.setPluginSnapshot("test-session", cwd, [{ capabilityId: "42", source: current.plugin.source, digest: current.plugin.digest, root: oldRoot, servers: [] }]);
    archive = fixtureZip(pluginFiles({ version: "2.2.0" }));
    const update = { ...input, version: "2.2.0", operation: "update" };
    const prepared = await install.prepareOrganizationPlugin(update);
    assert.equal(prepared.requiresApproval, false);
    current = await install.commitOrganizationPlugin({ ...update, preparationToken: prepared.preparationToken, approveAddresses: false });
    assert.equal(existsSync(oldRoot), true);
    assert.equal(resources.pluginPresentation(current, "test-session").state, "pending-reload");
    resources.clearPluginSnapshot("test-session");
    await resources.cleanupPluginDirectories(cwd, "project");
    assert.equal(existsSync(oldRoot), false);
  });
  await t.test("changed addresses and changed accounts need fresh approval", async () => {
    archive = fixtureZip(pluginFiles({ version: "2.3.0", url: "https://new-atlas.example/api/mcp" }));
    const update = { ...input, version: "2.3.0", operation: "update" };
    const prepared = await install.prepareOrganizationPlugin(update);
    assert.equal(prepared.requiresApproval, true);
    await assert.rejects(install.commitOrganizationPlugin({ ...update, preparationToken: prepared.preparationToken, approveAddresses: false }), /确认/);
    assert.equal(registry.readHazeRegistry(cwd, "project").installs[0].version, "2.2.0");
    current = await install.commitOrganizationPlugin({ ...update, preparationToken: prepared.preparationToken, approveAddresses: true });
    const other = await install.prepareOrganizationPlugin({ ...update, session: { ...session, principal: { subject: "user-b" } } });
    assert.equal(other.requiresApproval, true);
  });
  await t.test("tampered and expired preparations cannot replace the installed plugin", async () => {
    const prepared = await install.prepareOrganizationPlugin({ ...input, version: "2.3.0", operation: "update" });
    const { createHash } = await import("node:crypto");
    const stage = join(registry.pluginStorageRoot(cwd, "project"), ".staging", createHash("sha256").update(prepared.preparationToken).digest("hex"));
    await writeFile(join(stage, "package.zip"), fixtureZip());
    await assert.rejects(install.commitOrganizationPlugin({ ...input, version: "2.3.0", operation: "update", preparationToken: prepared.preparationToken, approveAddresses: true }), /内容发生变化/);
    const metadata = JSON.parse(await readFile(join(stage, "preparation.json"), "utf8")); metadata.expiresAt = 0; await writeFile(join(stage, "preparation.json"), JSON.stringify(metadata));
    await assert.rejects(install.commitOrganizationPlugin({ ...input, version: "2.3.0", operation: "update", preparationToken: prepared.preparationToken, approveAddresses: true }), /重新准备/);
    assert.equal(registry.readHazeRegistry(cwd, "project").installs[0].version, "2.3.0");
  });
  await t.test("project disabled overrides global and uninstall restores global", async () => {
    await registry.withHazeRegistryLock(cwd, "global", () => registry.writeHazeRegistry(cwd, "global", { version: 1, installs: [{ ...current, scope: "global" }] }));
    await install.mutateOrganizationPlugin(cwd, "project", "42", session, "set-disabled", true);
    assert.equal(registry.effectivePlugins(cwd, "https://haze.example")[0].disabled, true);
    assert.equal(resources.applyOrganizationPluginSkills(cwd, { skills: [], diagnostics: [] }).skills.length, 0);
    await install.mutateOrganizationPlugin(cwd, "project", "42", session, "uninstall");
    assert.equal(registry.effectivePlugins(cwd, "https://haze.example")[0].scope, "global");
  });
  await t.test("registry writes serialize concurrent changes", async () => {
    await Promise.all(["50", "51"].map((id) => registry.withHazeRegistryLock(cwd, "project", async () => { const state = registry.readHazeRegistry(cwd, "project"); await new Promise((done) => setTimeout(done, 15)); state.installs.push({ ...current, capabilityId: id }); await registry.writeHazeRegistry(cwd, "project", state); })));
    assert.deepEqual(registry.readHazeRegistry(cwd, "project").installs.map((entry) => entry.capabilityId).sort(), ["50", "51"]);
  });
  await t.test("installation API prepares and commits Plugin, and never returns private registration paths", async () => {
    const { writeRuntimeHazeSession } = await jiti.import("./auth/runtime-session.ts");
    await writeRuntimeHazeSession(session);
    const fixtureRoot = join(root, "route-fixture");
    const managed = await jiti.import("./haze-managed-capabilities.ts");
    globalThis.__organizationPluginRouteFixture = { session, cwd, install, resources, managed };
    t.after(() => { delete globalThis.__organizationPluginRouteFixture; });
    const stubs = {
      "lib/organization-extensions.ts": `exports.OrganizationExtensionsError = class extends Error {}; exports.getHazeMarketplaceSession = async () => ({accessToken:'test-only', session:globalThis.__organizationPluginRouteFixture.session}); exports.listOrganizationExtensions = async (type) => { if(type!=='plugin') throw Error('wrong type'); return [{id:'60',name:'Atlas',type:'Plugin',version:'2.3.0'}]; };`,
      "lib/file-access.ts": `exports.getAllowedFileRoots = async () => new Set([globalThis.__organizationPluginRouteFixture.cwd]); exports.isExistingFilePathAllowed = (path, roots) => roots.has(path);`,
      "lib/project-trust.ts": `exports.getProjectTrustStatus = () => ({trusted:true});`,
      "lib/auth/config.ts": `exports.getAuthConfig = () => ({issuer:'https://haze.example'});`,
      "lib/auth/runtime-session.ts": `exports.readRuntimeHazeSession = () => globalThis.__organizationPluginRouteFixture.session;`,
      "lib/haze-plugin-resources.ts": `exports.pluginPresentation = (...args) => globalThis.__organizationPluginRouteFixture.resources.pluginPresentation(...args);`,
      "lib/haze-plugin-install.ts": `for (const name of ['prepareOrganizationPlugin','commitOrganizationPlugin','mutateOrganizationPlugin','PluginInstallError']) exports[name] = globalThis.__organizationPluginRouteFixture.install[name];`,
      "lib/haze-managed-capabilities.ts": `for (const name of ['configureHazeManagedMcp','hazeMcpRuntimeOptions','installHazeCapability','listHazeManagedInstalls','setHazeCapabilityDisabled','uninstallHazeCapability']) exports[name] = globalThis.__organizationPluginRouteFixture.managed[name];`,
      "lib/request-security.ts": await readFile("lib/request-security.ts", "utf8"),
    };
    for (const [name, content] of Object.entries(stubs)) { const path = join(fixtureRoot, name); await mkdir(resolve(path, ".."), {recursive:true}); await writeFile(path, content); }
    const loader = createJiti(import.meta.url, { alias: { "@": fixtureRoot, "next/server": import.meta.resolve("next/server.js"), "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
    const { GET, POST } = await loader.import("../app/api/organization-extensions/[id]/installation/route.ts");
    const context = { params: Promise.resolve({ id: "60" }) };
    const request = (body) => new Request("http://localhost/api/organization-extensions/60/installation", { method: "POST", headers: { "Content-Type": "application/json", host: "localhost", origin: "http://localhost" }, body: JSON.stringify({ cwd, scope: "project", type: "Plugin", ...body }) });
    const preparedResponse = await POST(request({ action: "prepare", operation: "install" }), context);
    assert.equal(preparedResponse.status, 200, preparedResponse.status === 200 ? "" : await preparedResponse.clone().text());
    const prepared = await preparedResponse.json(); assert.equal(typeof prepared.preparationToken, "string");
    assert.equal((await POST(request({ action: "install", preparationToken: prepared.preparationToken, approveAddresses: true }), context)).status, 200);
    const listed = await (await GET(new Request(`http://localhost/api/organization-extensions/60/installation?cwd=${encodeURIComponent(cwd)}`), context)).json();
    assert.equal(listed.project[0].type, "Plugin");
    assert.equal(listed.project[0].plugin.state, "installed");
    assert.equal(JSON.stringify(listed).includes("test-only"), false);
    assert.equal(JSON.stringify(listed).includes('"root"'), false);
    assert.equal(JSON.stringify(listed).includes('"subject"'), false);
    assert.equal((await POST(request({ action: "prepare", operation: "install", scope: "invalid" }), context)).status, 400);
    assert.equal((await POST(request({ action: "prepare", operation: "install", type: "Unknown" }), context)).status, 400);
  });
});

test("credential guard rejects changed address, issuer, user or logout before credentials are fetched", () => {
  const guard = { source: "https://haze.example", subject: "user-a", url: "https://atlas.example/api/mcp" };
  const request = { url: guard.url }, session = { principal: { subject: "user-a" } };
  assert.doesNotThrow(() => validatePluginCredentialRequest(guard, request, guard.source, session));
  assert.throws(() => validatePluginCredentialRequest(guard, { url: "https://evil.example/api/mcp" }, guard.source, session), /address/);
  assert.throws(() => validatePluginCredentialRequest(guard, request, "https://other-haze.example", session), /account/);
  assert.throws(() => validatePluginCredentialRequest(guard, request, guard.source, { principal: { subject: "user-b" } }), /account/);
  assert.throws(() => validatePluginCredentialRequest(guard, request, guard.source, null), /account/);
});

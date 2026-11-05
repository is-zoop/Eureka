import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AutomationPublication } = await jiti.import("./automation-publication-service.ts");
const { PublicationStore } = await jiti.import("./automation-publication-store.ts");
const { HazePublishError } = await jiti.import("./haze-publishing.ts");
const { publicationSaveMode, parsePublicationDraft, archiveHash } = await jiti.import("./automation-publication.ts");
const { publicationDocumentationZip } = await jiti.import("./automation-publication-archive.ts");
const { automationExampleFiles } = await jiti.import("./automation-app-example.ts");
const { inspectAutomationFiles, writeAutomationAppZip } = await jiti.import("./automation-app-package.ts");
const { readPluginZip } = await jiti.import("./haze-plugin-package.ts");
const { appJsonValue } = await jiti.import("./automation-app-run.ts");
const owner = "a".repeat(64), issuer = "https://haze.example", subject = "member-1";
const context = {
  user: { id: 7, name: "Publisher" }, actions: { read: true, create: true, update: true, version: true, submit_review: true, publish: true },
  categories: [{ id: 1, name: "Tools" }], field_rules: {},
  uploads: { package_max_bytes: 10485760, documentation_max_bytes: 10485760, icon_max_bytes: 2097152, token_ttl_seconds: 1800, icon_formats: ["png", "jpg", "jpeg", "webp"] },
};
const clone = value => structuredClone(value);

async function fixture(work) {
  const base = await mkdtemp(join(tmpdir(), "eureka-publication-"));
  let pkg = inspectAutomationFiles(automationExampleFiles()), remote, failAfterCommit = false, rejection;
  let uploads = 0, mutations = 0, lookups = 0;
  const tokens = new Map(), requests = [], responses = new Map();
  const store = new PublicationStore(base, owner, pkg.manifest.automation.id, issuer, subject, () => {});
  const client = {
    async upload(kind, bytes) {
      const token = String(++uploads).padStart(32, "0"); tokens.set(token, { sha256: archiveHash(bytes), kind, bytes });
      return { upload_token: token, sha256: archiveHash(bytes), compatibility: { compatible: true } };
    },
    async request(path, method = "GET", body, key) {
      if (method === "GET") {
        lookups++;
        if (path.includes("automation_id=")) return { items: remote ? [clone(remote)] : [] };
        if (!remote || path !== `/api/developer/capabilities/${remote.id}`) throw new HazePublishError("Capability not found", 404, 4042);
        return clone(remote);
      }
      requests.push({ path, method, body: clone(body), key });
      if (responses.has(key)) return clone(responses.get(key));
      if (rejection) throw rejection;
      mutations++;
      if (path.endsWith("/capabilities")) remote = {
        id: 23, owner_id: 7, eureka_automation_id: pkg.manifest.automation.id, type: "plugin", code: body.code,
        revision: 1, is_listed: false, published_version: null, pending_version: body.version, pending_status: "draft", status: "draft", version: body.version, review_comment: null,
      };
      else if (path.includes("submit-review")) { remote.pending_status = remote.status = "reviewing"; remote.revision++; }
      else if (path.includes("/publish?")) { remote.status = "published"; remote.published_version = remote.version; remote.pending_version = remote.pending_status = null; remote.is_listed = true; remote.revision++; }
      else { if (path.endsWith("/versions")) { remote.version = remote.pending_version = body.version; remote.pending_status = remote.status = "draft"; } remote.revision++; }
      if (!path.includes("submit-review") && !path.includes("/publish?")) {
        Object.assign(remote, { name: body.name, description: body.description, category_id: body.category_id, tags: body.tags });
        if (body.package_upload_token) remote.package = { sha256: tokens.get(body.package_upload_token).sha256, path: "PRIVATE-STORAGE-PATH" };
        if (body.documentation_upload_token) remote.documentation = { sha256: tokens.get(body.documentation_upload_token).sha256 };
        remote.config = { doNotReturn: "PRIVATE-CONFIG" };
      }
      responses.set(key, clone(remote));
      if (failAfterCommit) { failAfterCommit = false; throw new HazePublishError("lost response", 502); }
      return clone(remote);
    },
  };
  const f = {
    store, client, requests, tokens, context: clone(context),
    get remote() { return remote; }, set remote(value) { remote = value; },
    get pkg() { return pkg; }, set pkg(value) { pkg = value; },
    get mutations() { return mutations; }, get uploads() { return uploads; }, get lookups() { return lookups; },
    loseResponse() { failAfterCommit = true; }, reject(error) { rejection = error; },
    async service(extra = {}) {
      const service = new AutomationPublication({ store, pkg, archive: writeAutomationAppZip(pkg.files), client, context: f.context, ownerKey: owner, runtimeId: "runtime-1", check: () => {}, assertCurrent: async () => {}, ...extra });
      await service.load(); return service;
    },
    draft(view) { return { ...view.draft, categoryId: 1, quickStart: "# Quick start\nChoose input and run.", changelog: "Added summary." }; },
  };
  try { await store.locked(() => work(f)); } finally { await rm(base, { recursive: true, force: true }); }
}

test("first publication uploads two public documents and no private runtime files; submit and publish are explicit", async () => fixture(async f => {
  const service = await f.service(), draft = f.draft(service.view());
  const saved = await service.saveRemote(draft, false);
  assert.equal(saved.remote.id, 23); assert.equal(saved.saved, true); assert.equal(saved.canSubmit, true);
  assert.equal(saved.canPublish, false); assert.equal(f.mutations, 1);
  const docs = [...f.tokens.values()].find(t => t.kind === "documentation");
  assert.deepEqual([...readPluginZip(docs.bytes).keys()], ["README.md", "quick_start.md"]);
  const listing = JSON.stringify(saved); assert.doesNotMatch(listing, /PRIVATE-STORAGE-PATH|PRIVATE-CONFIG/);
  const review = await service.transition("submit-review"); assert.equal(review.remote.pending_status, "reviewing");
  await assert.rejects(service.transition("publish"), /远端状态/);
  f.remote.pending_status = f.remote.status = "approved";
  const approved = await f.service(); assert.equal(approved.view().canPublish, true);
  const published = await approved.transition("publish"); assert.equal(published.remote.is_listed, true); assert.equal(published.remote.published_version, "1.0.0");
}));

test("a lost successful response replays the same key/body after restart without uploading or creating again", async () => fixture(async f => {
  const service = await f.service(); f.loseResponse();
  await assert.rejects(service.saveRemote(f.draft(service.view()), false), /lost response/);
  const first = clone(f.requests[0]), count = f.uploads;
  assert.ok((await f.store.read()).pending);
  const restarted = await f.service(); assert.equal(restarted.view().retryPending, true);
  await assert.rejects(restarted.saveLocal(restarted.view().draft), /恢复/);
  const result = await restarted.retry();
  assert.equal(result.saved, true); assert.equal(result.retryPending, false); assert.equal(f.mutations, 1); assert.equal(f.uploads, count);
  assert.deepEqual(f.requests[1], first); assert.equal(result.remote.id, 23);
}));

test("new versions keep the UUID, use a single metadata/version request, and cannot downgrade", async () => fixture(async f => {
  let service = await f.service(); await service.saveRemote(f.draft(service.view()), false);
  f.remote.status = "published"; f.remote.pending_status = f.remote.pending_version = null; f.remote.published_version = "1.0.0"; f.remote.is_listed = true;
  service = await f.service(); await assert.rejects(service.saveRemote(f.draft(service.view()), false), /更高版本/);
  f.pkg = inspectAutomationFiles(automationExampleFiles("1.1.0")); service = await f.service();
  const next = await service.saveRemote(f.draft(service.view()), false), request = f.requests.at(-1);
  assert.match(request.path, /\/23\/versions$/); assert.equal(request.body.version, "1.1.0"); assert.equal(request.body.base_revision, 1);
  assert.equal(request.body.name, next.draft.name); assert.ok(request.body.documentation_upload_token); assert.ok(request.body.changelog);
  assert.equal(next.remote.published_version, "1.0.0"); assert.equal(next.remote.pending_version, "1.1.0");
  await assert.rejects(service.saveRemote(f.draft(next), false), /线上展示/);
}));

test("live listing edits need explicit selection and do not replace a published package", async () => fixture(async f => {
  let service = await f.service(); await service.saveRemote(f.draft(service.view()), false);
  f.remote.status = "published"; f.remote.pending_status = f.remote.pending_version = null; f.remote.published_version = "1.0.0"; f.remote.is_listed = true;
  service = await f.service();
  await service.saveRemote({ ...f.draft(service.view()), description: "Updated listing" }, true);
  const request = f.requests.at(-1); assert.equal(request.method, "PATCH"); assert.equal(request.body.package_upload_token, undefined);
  assert.equal(f.remote.version, "1.0.0");
}));

test("remote ownership and app identity are checked even when the caller can see other assets", async () => fixture(async f => {
  const service = await f.service(); await service.saveRemote(f.draft(service.view()), false);
  f.remote.owner_id = 8; await assert.rejects(f.service(), /归属/);
  f.remote.owner_id = 7; f.remote.eureka_automation_id = "different-id"; await assert.rejects(f.service(), /UUID/);
}));

test("external metadata changes require saving again before review", async () => fixture(async f => {
  const service = await f.service(); await service.saveRemote(f.draft(service.view()), false);
  f.remote.description = "Changed in Haze";
  const next = await f.service(); assert.equal(next.view().canSubmit, false);
}));

test("a deleted bound application preserves the draft and invalidates only remote publication state", async () => fixture(async f => {
  const service = await f.service(); await service.saveRemote(f.draft(service.view()), false);
  const draft = { ...service.view().draft, readme: "User-edited documentation", quickStart: "User setup" };
  await service.saveLocal(draft);
  const uploads = f.uploads, requests = f.requests.length;
  f.remote = undefined;
  const restored = await f.service(), view = restored.view(), record = await f.store.read();
  assert.equal(view.remote, null); assert.equal(view.canSave, true);
  assert.equal(view.saved, false); assert.equal(view.canSubmit, false); assert.equal(view.canPublish, false);
  assert.deepEqual(view.draft, draft);
  for (const key of ["capabilityId", "remote", "saved", "baseline"]) assert.equal(record[key], undefined);
  assert.equal(f.uploads, uploads); assert.equal(f.requests.length, requests);
  assert.equal((await f.service()).view().remote, null);
}));

test("a missing old ID can rebind only to the caller's matching UUID without reusing saved proof", async () => fixture(async f => {
  const service = await f.service(); await service.saveRemote(f.draft(service.view()), false);
  f.remote = { ...f.remote, id: 24, code: "recreated-app" };
  const restored = await f.service(), view = restored.view();
  assert.equal(view.remote.id, 24); assert.equal(view.draft.code, "recreated-app");
  assert.equal(view.saved, false); assert.equal(view.canSubmit, false);
  assert.equal((await f.store.read()).capabilityId, 24); assert.equal(f.mutations, 1);
}));

test("auth errors, unknown 404s and failed UUID lookups never erase a binding", async () => fixture(async f => {
  const service = await f.service(); await service.saveRemote(f.draft(service.view()), false);
  const before = await f.store.read();
  for (const failure of [new HazePublishError("denied", 403), new HazePublishError("expired", 401), new HazePublishError("network", 502), new HazePublishError("unknown endpoint", 404)]) {
    let requests = 0;
    await assert.rejects(f.service({ client: { ...f.client, request: async () => { requests++; throw failure; } } }), error => error === failure);
    assert.equal(requests, 1); assert.deepEqual(await f.store.read(), before);
  }
  const lookupFailure = new HazePublishError("lookup denied", 403);
  await assert.rejects(f.service({ client: { ...f.client, request: async path => {
    if (path.includes("automation_id=")) throw lookupFailure;
    throw new HazePublishError("missing bound ID", 404, 4042);
  } } }), error => error === lookupFailure);
  assert.deepEqual(await f.store.read(), before); assert.equal(f.mutations, 1);
}));

test("deletion retires a pending request for the old ID without replaying it", async () => fixture(async f => {
  const service = await f.service(); await service.saveRemote(f.draft(service.view()), false);
  f.loseResponse(); await assert.rejects(service.transition("submit-review"), /lost response/);
  assert.ok((await f.store.read()).pending);
  const requests = f.requests.length; f.remote = undefined;
  const restored = await f.service();
  assert.equal(restored.view().retryPending, false); assert.equal(restored.view().remote, null);
  assert.equal(f.requests.length, requests); assert.equal((await f.store.read()).pending, undefined);
}));

test("an unresolved first-create request remains recoverable when UUID lookup is empty", async () => fixture(async f => {
  const service = await f.service(); f.loseResponse();
  await assert.rejects(service.saveRemote(f.draft(service.view()), false), /lost response/);
  const before = await f.store.read(), requests = f.requests.length; f.remote = undefined;
  const restored = await f.service();
  assert.equal(restored.view().retryPending, true); assert.equal(restored.view().canSave, false);
  assert.deepEqual((await f.store.read()).pending, before.pending); assert.equal(f.requests.length, requests);
}));

test("definite version conflicts clear the pending request and do not retry automatically", async () => fixture(async f => {
  const service = await f.service(); f.reject(new HazePublishError("revision conflict", 409, 40930));
  await assert.rejects(service.saveRemote(f.draft(service.view()), false), /revision conflict/);
  assert.equal((await f.store.read()).pending, undefined); assert.equal(f.requests.length, 1);
}));

test("permission denial and local code changes stop before uploads or remote mutation", async () => fixture(async f => {
  f.context.actions.create = false;
  let service = await f.service(); await assert.rejects(service.saveRemote(f.draft(service.view()), false), /权限/);
  assert.equal(f.uploads, 0);
  f.context.actions.create = true;
  service = await f.service({ assertCurrent: async () => { throw new Error("local changed"); } });
  await assert.rejects(service.saveRemote(f.draft(service.view()), false), /local changed/); assert.equal(f.uploads, 0);
}));

test("AI receives bounded verified public sources and categories, without icon or runtime configuration", async () => fixture(async f => {
  let input;
  const service = await f.service({ generateCopy: async (_rule, value) => {
    input = value; appJsonValue(input, 64000);
    return { name: "File tool", code: "file-tool", description: "Lists files", categoryId: 1, tags: ["Files"], readme: "# File tool", quickStart: "Choose a folder.", changelog: "Initial version." };
  } });
  const view = await service.generate("en", new AbortController().signal);
  assert.equal(view.draft.code, "file-tool"); assert.equal(view.draft.categoryId, 1); assert.equal(f.mutations, 0);
  assert.ok(input.package.sources.some(s => s.name === "scripts/main.mjs"));
  assert.doesNotMatch(JSON.stringify(input), /haze_|PRIVATE-CONFIG|publication\.json/);
  assert.equal(input.categories[0].id, 1);
}));

test("publication records are isolated by user and identity bindings cannot be reused", async () => fixture(async f => {
  const service = await f.service(); await service.saveLocal(f.draft(service.view()));
  const other = new PublicationStore(f.store.directory, "b".repeat(64), f.pkg.manifest.automation.id, issuer, "other", () => {});
  assert.equal(await other.read(), null);
  const raw = JSON.parse(await readFile(f.store.file, "utf8")); assert.equal(raw.subject, subject);
  assert.throws(() => new PublicationStore(".", "../invalid", "bad", issuer, subject, () => {}));
}));

test("state planning rejects review edits and lower versions; draft validation rejects invalid categories and icons", () => {
  assert.equal(publicationSaveMode(undefined, "1.0.0"), "create");
  assert.throws(() => publicationSaveMode({ version: "1.0.0", published_version: "1.0.0", pending_version: null }, "0.9.0"), /更高版本/);
  assert.throws(() => publicationSaveMode({ version: "1.1.0", published_version: "1.0.0", pending_version: "1.1.0", pending_status: "reviewing" }, "1.1.0"), /送审/);
  const draft = { name: "App", code: "app-tool", description: "Tool", categoryId: 1, tags: ["Files", "Files"], readme: "Docs", quickStart: "Start", changelog: "" };
  assert.deepEqual(parsePublicationDraft(draft, context, true).tags, ["Files"]);
  assert.throws(() => parsePublicationDraft({ ...draft, categoryId: 999 }, context), /分类/);
  assert.throws(() => parsePublicationDraft({ ...draft, icon: { name: "x.svg", type: "image/svg+xml", data: "eA==" } }, context), /图标/);
  const docs = readPluginZip(publicationDocumentationZip(draft)); assert.equal(docs.get("README.md").toString(), "Docs");
});

test("publication readers wait for an existing lock while concurrent mutations still reject", async () => {
  const base = await mkdtemp(join(tmpdir(), "eureka-publication-read-"));
  const appId = "c9677b6a-7991-4fc1-8d40-8862c3c9dcab";
  const makeStore = () => new PublicationStore(base, owner, appId, issuer, subject, () => {});
  let acquired, release;
  const started = new Promise(resolve => { acquired = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const writer = makeStore().locked(async () => { acquired(); await gate; });
  let reader;
  try {
    await started;
    reader = makeStore().locked(async () => "loaded", { wait: true }).then(value => ({ value }), error => ({ error }));
    await assert.rejects(makeStore().locked(async () => "must not run"), /正在处理发布操作/);
    assert.equal(await Promise.race([reader, new Promise(resolve => setTimeout(() => resolve("waiting"), 150))]), "waiting");
    release(); await writer;
    assert.deepEqual(await reader, { value: "loaded" });
  } finally { release(); await writer; await reader; await rm(base, { recursive: true, force: true }); }
});

test("local application edits seed publication fields once and do not overwrite later publication edits", async () => fixture(async f => {
  const metadata = { revision: "edit-1", name: "Renamed application", description: "Edited locally", categoryId: 1, tags: ["Local"], icon: null };
  let service = await f.service({ metadata });
  assert.equal(service.view().draft.name, metadata.name); assert.equal(service.view().draft.description, metadata.description);
  assert.deepEqual(service.view().draft.tags, metadata.tags);
  await service.saveLocal({ ...service.view().draft, name: "Marketplace name" });
  service = await f.service({ metadata }); assert.equal(service.view().draft.name, "Marketplace name");
  service = await f.service({ metadata: { ...metadata, revision: "edit-2", name: "New local name" } });
  assert.equal(service.view().draft.name, "New local name"); assert.equal(f.mutations, 0);
}));

test("opening publication refreshes editor metadata while retaining publication-only documentation", async () => fixture(async f => {
  const metadata = { revision: "edit-1", name: "Editor name", description: "Editor description", categoryId: 1, tags: ["Editor tag"], icon: null };
  const service = await f.service({ metadata });
  await service.saveLocal({ ...service.view().draft, name: "Old publishing name", description: "Old publishing description", quickStart: "Saved quick start", readme: "Saved documentation" });
  const opened = await service.load({ refreshMetadata: true });
  assert.equal(opened.draft.name, metadata.name); assert.equal(opened.draft.description, metadata.description);
  assert.equal(opened.draft.categoryId, 1); assert.deepEqual(opened.draft.tags, metadata.tags);
  assert.equal(opened.draft.quickStart, "Saved quick start"); assert.equal(opened.draft.readme, "Saved documentation");
  assert.equal(f.mutations, 0);
}));

test("AI publication copy preserves metadata supplied by the application editor", async () => fixture(async f => {
  const metadata = { revision: "edit-1", name: "Editor name", description: "Editor description", categoryId: 1, tags: ["Editor tag"], icon: null };
  const service = await f.service({ metadata, generateCopy: async () => ({ name: "AI name", code: "ai-slug", description: "AI description", categoryId: 0, tags: ["AI tag"], readme: "Generated documentation", quickStart: "Generated quick start", changelog: "Generated changes" }) });
  const result = await service.generate("en", new AbortController().signal);
  assert.equal(result.draft.name, metadata.name); assert.equal(result.draft.description, metadata.description);
  assert.equal(result.draft.categoryId, 1); assert.deepEqual(result.draft.tags, metadata.tags);
  assert.equal(result.draft.readme, "Generated documentation"); assert.equal(result.draft.quickStart, "Generated quick start");
}));

test("AI generates all basic fields for an application without saved editor metadata", async () => fixture(async f => {
  const metadata = { revision: "package-1", saved: false, name: "Package name", description: "Package description", categoryId: null, tags: [], icon: null };
  const generated = { name: "Generated name", code: "generated-app", description: "Generated description", categoryId: 1, tags: ["Generated tag"], readme: "Generated documentation", quickStart: "Generated quick start", changelog: "Generated changes" };
  const service = await f.service({ metadata, generateCopy: async () => generated });
  const result = await service.generate("en", new AbortController().signal);
  assert.deepEqual(result.draft, generated);
  const reopened = await service.load({ refreshMetadata: true });
  assert.deepEqual(reopened.draft, generated); assert.equal(f.mutations, 0);
}));

test("AI fills blank saved fields and keeps existing saved editor values across reopening", async () => fixture(async f => {
  const metadata = { revision: "edit-1", saved: true, name: "Saved name", description: "", categoryId: null, tags: [], icon: null };
  const service = await f.service({ metadata, generateCopy: async () => ({ name: "AI name", code: "filled-app", description: "Filled description", categoryId: 1, tags: ["Filled tag"], readme: "Docs", quickStart: "Quick start", changelog: "Changes" }) });
  const result = await service.generate("en", new AbortController().signal);
  assert.equal(result.draft.name, metadata.name); assert.equal(result.draft.description, "Filled description");
  assert.equal(result.draft.categoryId, 1); assert.deepEqual(result.draft.tags, ["Filled tag"]);
  const reopened = await service.load({ refreshMetadata: true });
  assert.equal(reopened.draft.name, metadata.name); assert.equal(reopened.draft.description, "Filled description");
  assert.equal(reopened.draft.categoryId, 1); assert.deepEqual(reopened.draft.tags, ["Filled tag"]);
}));

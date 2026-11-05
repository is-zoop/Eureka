import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { createServer } from "node:http";
import { once } from "node:events";
import { FormData as UploadFormData } from "undici";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { hazePublishFailure, hazeUploadBody } = await jiti.import("./haze-publishing.ts");
const { multiActionAutomationFixture } = await jiti.import("./test-fixtures/automation-multi-actions.ts");

test("multipart uploads retain ZIP bytes when Next fetch and global FormData use different implementations", async t => {
  const nativeFetch = globalThis.fetch, NativeRequest = globalThis.Request, previousFormData = globalThis.FormData;
  globalThis.FormData = UploadFormData;
  const received = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const parsed = await new NativeRequest("http://localhost/", { method: "POST", headers: req.headers, body: Buffer.concat(chunks) }).formData();
      const file = parsed.get("file");
      received.push({ name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()), contentType: req.headers["content-type"] });
      res.writeHead(200).end("ok");
    } catch { res.writeHead(400).end("invalid multipart"); }
  });
  t.after(async () => {
    globalThis.FormData = previousFormData;
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const files = [
    [multiActionAutomationFixture(), "text-functions-example-1.0.0.zip", "application/zip"],
    [Buffer.from("documentation-test"), "documentation.zip", "application/zip"],
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "icon.png", "image/png"],
  ];
  for (const [bytes, name, mime] of files) {
    const upload = await hazeUploadBody(bytes, name, mime);
    const response = await nativeFetch(`http://127.0.0.1:${server.address().port}/upload`, { method: "POST", ...upload, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    await response.text();
    const file = received.at(-1);
    assert.match(file.contentType, /^multipart\/form-data; boundary=/);
    assert.equal(file.name, name);
    assert.equal(file.type, mime);
    assert.deepEqual(file.bytes, bytes);
  }
});

test("Haze package errors identify the upload step and compatibility reason", () => {
  const error = hazePublishFailure(422, { code: 42231, data: { compatibility: { errors: ["Unsupported declaration fields: actions"] } } }, "/api/developer/uploads/package?type=plugin&target=eureka");
  assert.match(error.message, /上传应用包.*兼容性.*Unsupported declaration fields: actions/);
  assert.equal(error.hazeCode, 42231);
  assert.equal(error.status, 422);
});

test("Haze field errors show location and reason without input, context, or raw messages", () => {
  const error = hazePublishFailure(422, { code: 1001, data: { errors: [
    { loc: ["body", "tags", 0], type: "string_type", input: "PRIVATE INPUT", msg: "haze_secret", ctx: { token: "PRIVATE TOKEN" } },
    { loc: ["body", "version"], type: "string_pattern_mismatch" },
  ] } }, "/api/developer/capabilities");
  assert.match(error.message, /能力标签 \/ 第 1 项：需要文本/);
  assert.match(error.message, /版本：格式不符合要求/);
  assert.doesNotMatch(error.message, /PRIVATE|haze_secret/);
});

test("Haze default validation envelopes and category errors are actionable", () => {
  const error = hazePublishFailure(422, { detail: [{ loc: ["query", "type"], type: "missing" }] }, "/api/developer/uploads/package");
  assert.match(error.message, /上传应用包.*参数 \/ 类型：必填/);
  assert.match(hazePublishFailure(422, { code: 4222 }, "/api/developer/capabilities").message, /业务分类不存在/);
  assert.match(hazePublishFailure(503, null, "/api/developer/capabilities").message, /暂时不可用/);
});

test("Haze compatibility diagnostics remain bounded and redact credentials", () => {
  const error = hazePublishFailure(422, { data: { compatibility: { errors: ["haze_abc123", "x".repeat(2000)] } } }, "/api/developer/uploads/package");
  assert.doesNotMatch(error.message, /haze_abc123/);
  assert.match(error.message, /\[redacted\]/);
  assert.ok(error.message.length < 900);
});

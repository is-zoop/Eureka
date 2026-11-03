import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareReleaseArtifacts } from "./release-artifacts.mjs";

// Runs only after build/verification. Never prints the token or publishes a draft.
export async function publishDraft(info, { token, sha, fetchImpl = fetch }) {
if (!token || !/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("A GitHub Actions token and exact commit SHA are required.");
const base = `https://api.github.com/repos/${info.repo}`;
const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
async function request(path, method = "GET", body) {
  const response = await fetchImpl(`${base}${path}`, { method, headers: { ...headers, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 404 && method === "GET") return null;
  if (!response.ok) throw new Error(`GitHub release operation failed: ${method} ${path} HTTP ${response.status}.`);
  return response.status === 204 ? null : response.json();
}
let release = await request(`/releases/tags/${info.tag}`);
const tagRef = await request(`/git/ref/tags/${info.tag}`);
let tagObject = tagRef?.object;
for (let depth = 0; tagObject?.type === "tag" && depth < 5; depth++) tagObject = (await request(`/git/tags/${tagObject.sha}`))?.object;
if (tagRef && (tagObject?.type !== "commit" || tagObject.sha !== sha)) throw new Error("The release tag belongs to another commit. Refusing to attach mismatched installer assets.");
if (release) {
  const target = tagObject?.sha ?? release.target_commitish;
  if (!release.draft || target !== sha) throw new Error("Refusing to overwrite a published release or a draft belonging to another commit. Use a new version.");
}
if (!release) release = await request("/releases", "POST", { tag_name: info.tag, target_commitish: sha, name: `Eureka ${info.tag}`, body: info.notes, draft: true, prerelease: false });
else await request(`/releases/${release.id}`, "PATCH", { body: info.notes });
// Publish the manifest last. Existing assets are replaced only on a matching draft.
for (const name of info.filenames.filter(name => name !== "latest.json").concat("latest.json")) {
  const existing = release.assets?.find(asset => asset.name === name);
  if (existing) await request(`/releases/assets/${existing.id}`, "DELETE");
  const url = new URL(release.upload_url.split("{")[0]);
  if (url.protocol !== "https:" || url.hostname !== "uploads.github.com") throw new Error("Unexpected GitHub upload destination.");
  url.searchParams.set("name", name);
  const path = join(info.directory, name), size = (await stat(path)).size;
  const response = await fetchImpl(url, { method: "POST", headers: { ...headers, "Content-Type": name.endsWith(".json") ? "application/json" : "application/octet-stream", "Content-Length": String(size) }, body: Readable.toWeb(createReadStream(path)), duplex: "half" });
  if (!response.ok) throw new Error(`GitHub asset upload failed for ${name}: HTTP ${response.status}. The release remains a draft.`);
  console.log(`Uploaded ${name}.`);
}
const completed = await request(`/releases/${release.id}`);
for (const name of info.filenames) if (!completed.assets.some(asset => asset.name === name && asset.state === "uploaded")) throw new Error(`Release asset verification failed: ${name}.`);
console.log(`Draft ready for review: ${completed.html_url}`);
return completed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const info = prepareReleaseArtifacts();
const completed = await publishDraft(info, { token: process.env.GITHUB_TOKEN, sha: process.env.GITHUB_SHA });
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Eureka ${info.tag}\n\n[Review the draft release](${completed.html_url})\n\nThe installer signature was verified against the embedded public key. All assets were uploaded. The release remains a draft pending installation testing.\n`);
}
}

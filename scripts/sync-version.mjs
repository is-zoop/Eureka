import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Only edit application metadata. Dependency versions and lock resolutions stay intact.
export function syncVersions(root = projectRoot, { check = false } = {}) {
  const read = (path) => readFileSync(join(root, path), "utf8");
  const source = JSON.parse(read("package.json"));
  const version = source.version;
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("package.json must contain a stable major.minor.patch version.");
  }

  const changes = [];
  const stage = (path, before, after) => {
    if (before !== after) changes.push({ path, content: after });
  };
  const json = (path, update) => {
    const before = read(path);
    const value = JSON.parse(before);
    const original = JSON.stringify(value);
    update(value);
    if (JSON.stringify(value) === original) return;
    const newline = before.includes("\r\n") ? "\r\n" : "\n";
    const after = JSON.stringify(value, null, 2).replaceAll("\n", newline) + newline;
    stage(path, before, after);
  };
  json("package-lock.json", (value) => {
    value.name = source.name;
    value.version = version;
    value.packages[""].name = source.name;
    value.packages[""].version = version;
  });
  json("desktop/package.json", (value) => {
    value.version = version;
    value.homepage = source.homepage;
    value.repository = source.repository;
    value.bugs = source.bugs;
  });
  json("desktop/package-lock.json", (value) => {
    value.version = version;
    value.packages[""].version = version;
  });
  json("desktop/src-tauri/tauri.conf.json", (value) => { value.version = version; });

  const cargoPath = "desktop/src-tauri/Cargo.toml";
  const cargo = read(cargoPath);
  const packageSection = /(^\[package\]\r?\n)([\s\S]*?)(?=^\[|(?![\s\S]))/m;
  const ownVersion = /^(version\s*=\s*")[^"]+("[^\r\n]*)$/m;
  const section = cargo.match(packageSection);
  if (!section || !ownVersion.test(section[2])) throw new Error("Cargo.toml is missing [package].version.");
  stage(cargoPath, cargo, cargo.replace(packageSection, (_, header, body) =>
    header + body.replace(ownVersion, (_, prefix, suffix) => `${prefix}${version}${suffix}`)));

  const lockPath = "desktop/src-tauri/Cargo.lock";
  const lock = read(lockPath);
  const ownPackage = /(^\[\[package\]\]\r?\nname = "eureka"\r?\nversion = ")[^"]+(")/m;
  if (!ownPackage.test(lock)) throw new Error("Cargo.lock is missing the eureka package.");
  stage(lockPath, lock, lock.replace(ownPackage, (_, prefix, suffix) => `${prefix}${version}${suffix}`));

  // Finish parsing all files before writing any of them.
  if (check && changes.length) {
    throw new Error(`Release metadata differs from package.json (${version}):\n${changes.map(({ path }) => `  ${path}`).join("\n")}\nRun npm run version:sync.`);
  }
  if (!check) for (const { path, content } of changes) writeFileSync(join(root, path), content);
  return { version, changedFiles: changes.map(({ path }) => path) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const check = process.argv.includes("--check");
    const result = syncVersions(projectRoot, { check });
    console.log(`Eureka ${result.version}: ${check ? "release metadata verified" : `synchronized ${result.changedFiles.length} file(s)`}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

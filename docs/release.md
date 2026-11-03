# Eureka desktop releases

## Release identity

- Product: **Eureka**.
- Repository and GitHub Releases: `is-zoop/Eureka`.
- Production identifier: `com.eureka.desktop`.
- Development identifier: `com.eureka.desktop.dev` (separate single-instance identity).
- Installer: NSIS, Windows x64, current-user installation.
- Tag: `v<version>`, for example `v0.8.8`.
- Installer filename: `Eureka_<version>_x64-setup.exe`.

The root `package.json` is the only version source. The current baseline is
`0.8.8`. Its repository/homepage/bugs metadata also defines the desktop package's
release identity. Do not independently bump desktop/Rust versions or change the
application identifier or installation mode for a routine release.

## Synchronize and verify

From the repository root:

```powershell
npm run version:sync
npm run version:check
```

Synchronization updates application metadata in the root `package-lock.json`,
`desktop/package.json`, `desktop/package-lock.json`,
`desktop/src-tauri/tauri.conf.json`, `[package].version` in `Cargo.toml`, and the
`eureka` package version in `Cargo.lock`. Dependency versions and resolutions are
preserved. `version:check` is read-only and fails when metadata is out of sync.
Web builds, desktop development and resource preparation synchronize automatically.
Before invoking the Tauri CLI directly, synchronize manually.

For a future release, bump only the root version:

```powershell
npm version patch --no-git-tag-version
npm run version:check
```

The npm `version` lifecycle hook synchronizes desktop and Cargo metadata. After
editing the root version directly, run `npm run version:sync`. This initial setup
keeps `0.8.8`; it does not bump the version. Stable `major.minor.patch` versions
are supported in this phase.

## Prepare the installer

Review the intended release changes and ensure the GitHub account can publish to
`is-zoop/Eureka`:

```powershell
git status --short --branch
gh auth status
npm ci
npm ci --prefix desktop
npm run browser:install
npm run version:check
npm run release
```

Build on Windows x64 with Node.js 22.19 or newer, Rust and Windows C++ Build Tools.
`release` checks version consistency and builds the desktop installer. It does
**not** bump the version, publish npm, create tags, push, or publish a Release.
The build prepares Node/Next/Chromium resources, verifies the packaged server,
then creates the NSIS installer under `desktop/src-tauri/target/release/bundle/nsis/`.

This performs a production Next build: stop development first or build from an
isolated checkout to avoid overwriting the dev server's `.next` directory. Review
bundled runtime configuration before distribution: only four public login fields
are included. Raw `.env*` files and signing keys are excluded from resources.
The native shell creates and retains a per-installation session encryption key.
See [desktop packaging notes](../desktop/README.md).

## GitHub Actions draft release (preferred)

The workflow is `.github/workflows/release-desktop.yml`. It references the GitHub
Environment **`TAURI_SIGNING_PRIVATE_KEY`** and reads its Secret with the same
name. The current key is unencrypted; no password Secret is required. The job
requests only the repository content write permission needed for Release assets.
The initial `codex/desktop-release` branch also triggers draft builds, so the
first installer can be checked before creating a version tag. When no tag exists,
the draft pins its exact source commit; publishing it creates the version tag.

Add `docs/releases/v<version>.md`, run `npm run release:check`, and commit all
release changes before pushing the version tag. The workflow can also be run
manually from Actions on the intended committed ref. Both paths validate versions,
install Node/Rust/Chromium, build and verify the packaged server, verify the signed
installer against the embedded public key, then upload a draft Release. The
version remains `0.8.8` for the first updater-enabled installer.

Draft assets are the NSIS `.exe`, matching `.exe.sig`, `latest.json`, and
`SHA256SUMS.txt`. The manifest is uploaded last and references the fixed version
URL. All assets are also retained under the workflow's Actions artifacts.
The workflow does not publish the draft. A published release cannot be overwritten
on a retry, and an existing draft must point to the same commit.

## Manual release fallback

Commit intended release changes, including synchronized manifests and lock files.
Substitute the root package version for `<version>` and prepare Chinese/English
release notes from commits since the previous release:

```powershell
git tag -a v<version> -m "Eureka v<version>"
git push origin v<version>
npm run release:artifacts
gh release create v<version> desktop/release/Eureka_<version>_x64-setup.exe desktop/release/Eureka_<version>_x64-setup.exe.sig desktop/release/latest.json desktop/release/SHA256SUMS.txt --repo is-zoop/Eureka --verify-tag --draft --title "Eureka v<version>" --notes-file desktop/release/release-notes.md
```

Verify installation, application version, startup and retained user data, then
publish the draft:

```powershell
gh release edit v<version> --repo is-zoop/Eureka --draft=false
gh release view v<version> --repo is-zoop/Eureka
npm run version:check
```

## Update support status

Use [the installation and upgrade acceptance checklist](upgrade-acceptance.md)
before publishing a draft. `npm run desktop:verify -- before` and `-- after`
provide local, read-only file-retention checks; they do not replace actual installer testing.

`/api/app-update` checks this repository's latest stable GitHub Release instead
of an unrelated npm package. It only reports a version and release-notes link.
No accessible published release returns no available update; other upstream
failures are reported as errors.

The native updater is now connected through `lib/desktop-updater.ts`: separate
check/download/install commands and progress events, signature verification, and
installation preflight/cleanup. See [native updater setup](../desktop/README.md#native-updater)
for private key backup and build configuration. Debug/development builds cannot
check or install updates. The application version remains `0.8.8`.

The blue button above the navigation rail's account avatar appears only when a
newer version is known. Its first click downloads in the background; a second
click after verification quits Eureka and installs the update. Clicking during
download opens the progress dialog, and failures open recovery guidance.
Help → Check for updates always opens the dialog for manual checks, notes,
progress and retries. It is not part of Settings. `latest.json`
generation and the GitHub Actions draft publishing workflow are connected.
Before distributing a signed release, upload its matching
installer, `.sig`, and `latest.json`; the manifest's `signature` must contain the
signature file contents, and `platforms.windows-x86_64.url` must reference the
version-specific HTTPS installer URL. Do not publish a manifest before its
installer is available. Test upgrade from `0.8.8` to a higher version in an
isolated installed copy, including task-busy rejection, invalid signatures and
process cleanup. Existing installers without an updater need manual replacement.

# Haze SDK validation integration

SDK 1.3 adds `ctx.artifacts.fromFile` and shared artifact limits (1 GiB per file, 64 artifacts per run). Business AI preferences and local schedules are private host settings, not published application declaration fields. Deploy the matching generated contract and manifest; these host settings require no cloud-user binding or scheduler service.

`automation-sdk-contract.json` is exported from Eureka's canonical contract. Do not edit the exported copy. Run `node scripts/export-automation-sdk-contract.mjs` after changing the source; `--check` detects stale exports. `manifest.json` pins the SDK version and SHA256.

In Haze's `eureka_package.py`, replace outdated **declaration-field/type allow-lists** with `validate_sdk_files(files)` from `eureka_sdk_validator.py`. Merge returned errors into the existing `compatibility.errors`; retain the existing authentication, upload limits, ZIP traversal/link/CRC checks, ownership, code scanning and publication workflow. Do not bypass existing checks on validation failure.

Install `requirements.txt` in Haze's Python environment. This adapter supports request/bytes/allowDynamicUrl, multiple actions, UI layouts and workflow schemas. SDK runtime methods such as tables and chunk I/O require no new manifest capability: they use existing files.read/files.write. Haze does not execute scripts or contact business URLs during validation.

SDK 1.2 adds request `auth`, `multipart`, `responseHeaders`, `redirects`, `timeoutMs`, opt-in `automation.checkpoints`, locator `context` steps (`frame` / `shadow`), and browser operation `kind:upload` with `upload` constraints. Deploy the generated contract, manifest, fixtures and adapter together. Remove duplicate old field/type rejections for these declarations; retain semantic authorization and security checks. Browser/API uploads require `files.read` and mutation `browser.write`; the runtime still enforces actual user file grants, same-origin frame scope and account-bound approvals. Secrets are never part of published packages. Native features require an updated Eureka desktop binary.

The JSON Schema validates portable declaration structure. Eureka's runtime additionally checks actual file grants, site/URL authorization, credentials, current run identity and filesystem state; these checks cannot be performed statically in Haze. Existing Haze semantic/security checks must remain in place.

Contract fixtures in `lib/automation-sdk-contract-fixtures.json` (exported here as `contract-fixtures.json`) are shared by Node, Python and native Rust request tests. Node/Python parity requires Python jsonschema. Deploy this adapter with its matching JSON and manifest files; this repository does not deploy Haze itself.

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true,
  alias: {
    "./ui/dialog": fileURLToPath(new URL("./test-fixtures/dialog-ssr.mjs", import.meta.url)),
    "next/image": fileURLToPath(new URL("./test-fixtures/next-image-ssr.mjs", import.meta.url)),
  },
});
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { AutomationAppPublish } = await jiti.import("./AutomationAppPublish.tsx");
const { AutomationPublicationDocument } = await jiti.import("./AutomationPublicationDocument.tsx");
const identity = { ownerKey: "owner", runtimeId: "runtime" };
const props = { appId: "c9677b6a-7991-4fc1-8d40-8862c3c9dcab", index: identity, active: true, onClose() {} };
const render = initialView => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(AutomationAppPublish, { ...props, initialView })));

test("publication does not render a modal or backdrop before preparation finishes", () => {
  assert.equal(render(null), "");
});

test("prepared publication uses the shared editor fields and omits connection and introduction copy", () => {
  const html = render({ ...identity, version: "1.1.0", digest: "digest", remote: null, retryPending: false, saved: false, canSave: true, canSubmit: false, canPublish: false,
    context: { user: { id: 7, name: "Publisher" }, actions: { read: true, create: true, update: true }, categories: [{ id: 2, name: "Haze category" }], uploads: { icon_max_bytes: 2097152 } },
    draft: { name: "Edited application", code: "edited-app", description: "Edited description", categoryId: 2, tags: ["Reports", "Tools"], readme: "# Saved docs", quickStart: "Choose inputs", changelog: "", icon: { name: "icon-should-not-be-shown.png", type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=" } },
  });
  assert.match(html, /role="dialog"/);
  assert.match(html, /Publish application/);
  const tabs = [...html.matchAll(/role="tab"[^>]*>(.*?)<\/button>/g)].map(match => match[1]);
  assert.deepEqual(tabs, ["Basic information", "Quick start", "Documentation"]);
  assert.ok(html.indexOf("Generate with AI") > html.indexOf("Documentation</button>"));
  assert.ok(html.indexOf('role="tablist"') < html.indexOf('id="app-publish-name"'));
  assert.match(html, /sm:grid-cols-2/);
  assert.ok(html.indexOf('id="app-publish-name"') < html.indexOf('id="app-publish-code"'));
  assert.ok(html.indexOf('id="app-publish-code"') < html.indexOf('id="app-publish-version"'));
  assert.ok(html.indexOf('id="app-publish-icon"') < html.indexOf('id="app-publish-category"'));
  assert.ok(html.indexOf('id="app-publish-version"') < html.indexOf('id="app-publish-tags"'));
  assert.ok(html.indexOf('id="app-publish-tags"') < html.indexOf('id="app-publish-description"'));
  assert.match(html, /lucide-sparkles/);
  assert.doesNotMatch(html, /icon-should-not-be-shown\.png/);
  for (const id of ["name", "icon", "category", "tags", "description"]) assert.match(html, new RegExp('for="app-publish-' + id + '"'));
  for (const value of ["Edited application", "Edited description", "Haze category", "Reports, Tools"]) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /Connecting to Haze|Prepare the listing|First publication|Publisher:|field-description|820px/);
  assert.match(html, /id="app-publish-version"[^>]*readOnly|readonly[^>]*id="app-publish-version"|id="app-publish-version"[^>]*readonly/i);
  for (const id of ["name", "code", "category", "description", "version"]) {
    const label = html.match(new RegExp('<label[^>]*for="app-publish-' + id + '"[^>]*>([\\s\\S]*?)</label>'))?.[1];
    assert.ok(label, id); assert.match(label, /text-\[var\(--danger\)\]/); assert.match(label, /\*<\/span>/);
  }
});

test("both document pages default to Markdown preview with an edit toggle and required marker", () => {
  for (const [id, title] of [["quickStart", "Quick start"], ["readme", "Documentation"]]) {
    const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(AutomationPublicationDocument, { id, title, value: "# Preview content\n\nDocument text.", maxLength: 100000, disabled: false, onChange() {} })));
    assert.match(html, /data-publication-document-preview/); assert.match(html, /Preview content<\/h1>/);
    assert.match(html, /role="region"/); assert.match(html, /overflow-y-auto/); assert.match(html, /min-h-0 flex-1/);
    assert.match(html, />Edit<\/button>/); assert.match(html, /aria-pressed="false"/);
    assert.match(html, /text-\[var\(--danger\)\]/); assert.doesNotMatch(html, /<textarea/);
  }
});

test("publication feedback is not printed inside the dialog body", () => {
  const html = render({ ...identity, version: "1.0.0", digest: "digest", retryPending: true, saved: false, canSave: false, canSubmit: false, canPublish: false,
    context: { user: { id: 7, name: "Publisher" }, actions: {}, categories: [], uploads: { icon_max_bytes: 2097152 } },
    remote: { status: "rejected", pending_status: "rejected", review_comment: "Review feedback belongs in Alert", published_version: null },
    draft: { name: "App", code: "app-code", description: "Description", categoryId: null, tags: [], readme: "", quickStart: "", changelog: "" },
  });
  assert.doesNotMatch(html, /Review feedback belongs in Alert|Previous submission unconfirmed|data-slot="field-error"/);
  assert.match(html, /Resume previous operation/);
});

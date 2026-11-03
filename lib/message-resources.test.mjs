import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parseLeadingFileReferences, exactSkillCapability } = await jiti.import("./message-resources.ts");
test("leading references accept Windows drives, spaces, UNC folders and mixed paths", () => {
  const parsed = parseLeadingFileReferences('@"C:/Users/Test/新建 XLSX 工作表 (2).xlsx" @"\\\\server\\share\\" @src/main.ts 使用这个表格');
  assert.deepEqual(parsed.references, [
    { path: "C:/Users/Test/新建 XLSX 工作表 (2).xlsx", isDir: false },
    { path: "\\\\server\\share", isDir: true }, { path: "src/main.ts", isDir: false },
  ]);
  assert.equal(parsed.body, "使用这个表格");
});
test("line references, URLs, incomplete quotes and inline prose are not removed", () => {
  for (const content of ['@src/main.ts:10 check', '@"C:/a.ts":10 check', '@https://example.com text', '@"unfinished path', 'See @src/main.ts here']) {
    assert.deepEqual(parseLeadingFileReferences(content), { references: [], body: content });
  }
});
test("skill icons require exact resource identity, never just a coincident name", () => {
  const capability = { capabilityId: "42", source: "https://haze.example" };
  const skills = [{ name: "report", filePath: "C:/plugins/42/SKILL.md", organizationCapability: capability }];
  assert.deepEqual(exactSkillCapability(skills, "report", "c:\\plugins\\42\\SKILL.md"), capability);
  assert.equal(exactSkillCapability(skills, "report", "C:/other/SKILL.md"), undefined);
  assert.equal(exactSkillCapability(skills, "another", skills[0].filePath), undefined);
  assert.equal(exactSkillCapability([...skills, { name: "report", filePath: "/local/SKILL.md" }], "report"), undefined);
  assert.equal(exactSkillCapability([{ ...skills[0], filePath: "/Skills/SKILL.md" }], "report", "/skills/SKILL.md"), undefined);
});

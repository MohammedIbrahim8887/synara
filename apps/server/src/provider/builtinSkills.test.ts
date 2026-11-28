import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { VISUALIZE_SKILL_MARKDOWN, VISUALIZE_SKILL_NAME } from "@synara/shared/visualizeSkill";

import { installBuiltinSkills } from "./builtinSkills.ts";
import { parseSkillFrontmatter } from "./skillsCatalog.ts";

const dirs: string[] = [];
async function tempSkillsDir() {
  const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "sona-builtin-skills-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("built-in skills", () => {
  const skillFile = (dir: string) => nodePath.join(dir, VISUALIZE_SKILL_NAME, "SKILL.md");

  it("installs the visualize skill with valid frontmatter", async () => {
    const dir = await tempSkillsDir();
    await installBuiltinSkills(dir);
    const text = await fs.readFile(skillFile(dir), "utf8");
    expect(text).toBe(VISUALIZE_SKILL_MARKDOWN);
    expect(parseSkillFrontmatter(text).name).toBe(VISUALIZE_SKILL_NAME);
  });

  it("refreshes an older Sona copy but keeps a user-owned copy", async () => {
    const dir = await tempSkillsDir();
    await fs.mkdir(nodePath.dirname(skillFile(dir)), { recursive: true });
    await fs.writeFile(skillFile(dir), "old\n<!-- sona-builtin-skill: visualize v0 -->\n");
    await installBuiltinSkills(dir);
    expect(await fs.readFile(skillFile(dir), "utf8")).toBe(VISUALIZE_SKILL_MARKDOWN);

    await fs.writeFile(skillFile(dir), "my own version");
    await installBuiltinSkills(dir);
    expect(await fs.readFile(skillFile(dir), "utf8")).toBe("my own version");
  });
});

// FILE: builtinSkills.ts
// Purpose: Installs skills that ship with Sona into the portable skills folder so
//          every provider can discover them through the unified skills catalog.
// Layer: Server provider helper
// Exports: installBuiltinSkills

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import {
  VISUALIZE_SKILL_MARKDOWN,
  VISUALIZE_SKILL_NAME,
  VISUALIZE_SKILL_VERSION,
} from "@synara/shared/visualizeSkill";

interface BuiltinSkill {
  readonly name: string;
  readonly version: number;
  readonly markdown: string;
}

const BUILTIN_SKILLS: ReadonlyArray<BuiltinSkill> = [
  {
    name: VISUALIZE_SKILL_NAME,
    version: VISUALIZE_SKILL_VERSION,
    markdown: VISUALIZE_SKILL_MARKDOWN,
  },
];

const MARKER_PATTERN = /<!-- sona-builtin-skill: ([\w-]+) v(\d+) -->/;

/**
 * Writes a built-in skill when it is missing, or refreshes a copy Sona wrote at an
 * older version. A copy without Sona's marker belongs to the user and is left alone,
 * so removing the marker opts a skill out of updates.
 */
export async function installBuiltinSkills(skillsDir: string): Promise<void> {
  await Promise.all(
    BUILTIN_SKILLS.map(async (skill) => {
      const file = nodePath.join(skillsDir, skill.name, "SKILL.md");
      let existing: string | null = null;
      try {
        existing = await fs.readFile(file, "utf8");
      } catch {
        existing = null;
      }
      if (existing !== null) {
        const marker = existing.match(MARKER_PATTERN);
        if (!marker || marker[1] !== skill.name || Number(marker[2]) >= skill.version) return;
      }
      try {
        await fs.mkdir(nodePath.dirname(file), { recursive: true });
        await fs.writeFile(file, skill.markdown, "utf8");
      } catch {
        // A read-only skills folder only means the built-in skill is unavailable.
      }
    }),
  );
}

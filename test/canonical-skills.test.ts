import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { profileSchema, skillSchema } from "../src/schema/index.js";

const expectedSkillIds = [
  "implementation-plan",
  "build-handoff",
  "code-review",
  "debugging-loop",
  "skill-capture",
  "handoff"
];

const standardBodySections = ["## When To Use", "## Procedure", "## Output Format", "## What Not To Do"];

describe("canonical skill files", () => {
  it("includes exactly the expected canonical skills", async () => {
    const skillIds = await Promise.all(
      expectedSkillIds.map(async (id) => {
        const skillDir = join(process.cwd(), "skills", id);
        const metadata = parse(await readFile(join(skillDir, "skill.yml"), "utf8"));

        return skillSchema.parse(metadata).id;
      })
    );

    expect(skillIds).toEqual(expectedSkillIds);
  });

  it("includes schema-valid skills with non-empty standard bodies", async () => {
    for (const id of expectedSkillIds) {
      const skillDir = join(process.cwd(), "skills", id);
      const metadata = parse(await readFile(join(skillDir, "skill.yml"), "utf8"));
      const body = await readFile(join(skillDir, "body.md"), "utf8");
      const skill = skillSchema.parse(metadata);

      expect(skill.id).toBe(id);
      expect(body.trim().length).toBeGreaterThan(0);

      for (const section of standardBodySections) {
        expect(body).toContain(section);
      }
    }
  });

  it("includes schema-valid baseline profiles for the current canonical library", async () => {
    for (const name of ["minimal", "coding-heavy"]) {
      const profilePath = join(process.cwd(), "profiles", `${name}.yml`);
      const profile = parse(await readFile(profilePath, "utf8"));

      expect(profileSchema.parse(profile)).toMatchObject({
        name,
        skills: expectedSkillIds
      });
    }
  });
});

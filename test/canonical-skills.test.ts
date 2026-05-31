import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { profileSchema, skillSchema } from "../src/schema/index.js";

describe("canonical skill files", () => {
  it("includes a schema-valid handoff skill", async () => {
    const skillDir = join(process.cwd(), "skills", "handoff");
    const metadata = parse(await readFile(join(skillDir, "skill.yml"), "utf8"));
    const body = await readFile(join(skillDir, "body.md"), "utf8");

    expect(skillSchema.parse(metadata)).toMatchObject({
      id: "handoff",
      name: "Handoff"
    });
    expect(body.trim()).toContain("Write a handoff document");
  });

  it("includes schema-valid baseline profiles for the current canonical library", async () => {
    for (const name of ["minimal", "coding-heavy"]) {
      const profilePath = join(process.cwd(), "profiles", `${name}.yml`);
      const profile = parse(await readFile(profilePath, "utf8"));

      expect(profileSchema.parse(profile)).toMatchObject({
        name,
        skills: ["handoff"]
      });
    }
  });
});

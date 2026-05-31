import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { skillSchema } from "../src/schema/index.js";

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
});

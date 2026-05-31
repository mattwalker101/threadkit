import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { skillSchema, type Skill } from "../schema/index.js";

export interface LoadedSkill {
  id: string;
  dir: string;
  metadata: Skill;
  body: string;
}

export async function loadSkill(args: { root: string; id: string }): Promise<LoadedSkill> {
  const dir = join(args.root, "skills", args.id);
  const metadata = skillSchema.parse(parse(await readFile(join(dir, "skill.yml"), "utf8")));
  const body = await readFile(join(dir, "body.md"), "utf8");

  if (metadata.id !== args.id) {
    throw new Error(`Skill directory '${args.id}' does not match skill id '${metadata.id}'.`);
  }

  if (body.trim().length === 0) {
    throw new Error(`Skill '${metadata.id}' has an empty body.md.`);
  }

  return {
    id: metadata.id,
    dir,
    metadata,
    body
  };
}

export async function loadSkills(root: string): Promise<LoadedSkill[]> {
  const entries = await readdir(join(root, "skills"), { withFileTypes: true });
  const skillIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return Promise.all(skillIds.map((id) => loadSkill({ root, id })));
}

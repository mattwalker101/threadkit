import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { FileSpec, RenderInput } from "./renderTypes.js";

type Skill = RenderInput["skills"][number];
type PayloadDirectory = "assets" | "scripts";

export type KnownTarget = keyof Skill["metadata"]["targets"];

export function enabledSkills(skills: Skill[], targetKey: KnownTarget): Skill[] {
  return skills.filter((skill) => skill.metadata.targets[targetKey]?.enabled === true);
}

export function commandNameForSkill(skill: Skill, targetKey: KnownTarget): string {
  return skill.metadata.target_overrides?.[targetKey]?.command_name ?? skill.id;
}

function discoverPayloadFiles(args: {
  skillDir: string;
  payloadDir: PayloadDirectory;
  currentRelPath?: string;
}): Array<{ payloadRelPath: string; copySource: string }> {
  const baseDir = join(args.skillDir, args.payloadDir);
  const currentDir = args.currentRelPath === undefined ? baseDir : join(baseDir, args.currentRelPath);
  let entries;

  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return [];
    }

    throw error;
  }

  const files: Array<{ payloadRelPath: string; copySource: string }> = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const entryRelPath = args.currentRelPath === undefined ? entry.name : `${args.currentRelPath}/${entry.name}`;

    if (entry.isDirectory()) {
      files.push(
        ...discoverPayloadFiles({
          skillDir: args.skillDir,
          payloadDir: args.payloadDir,
          currentRelPath: entryRelPath
        })
      );
    } else if (entry.isFile()) {
      files.push({
        payloadRelPath: entryRelPath,
        copySource: join(baseDir, entryRelPath)
      });
    }
  }

  return files;
}

export function renderSkillPayloadFiles(args: {
  skills: Skill[];
  targetKey: KnownTarget;
  relPathForPayload: (args: { skill: Skill; payloadDir: PayloadDirectory; payloadRelPath: string }) => string;
}): FileSpec[] {
  return enabledSkills(args.skills, args.targetKey).flatMap((skill) =>
    (["assets", "scripts"] as const).flatMap((payloadDir) =>
      discoverPayloadFiles({ skillDir: skill.dir, payloadDir }).map(({ payloadRelPath, copySource }) => ({
        relPath: args.relPathForPayload({ skill, payloadDir, payloadRelPath }),
        copySource,
        marker: true
      }))
    )
  );
}

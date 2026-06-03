import type { RenderInput } from "./renderTypes.js";

type Skill = RenderInput["skills"][number];

export type KnownTarget = keyof Skill["metadata"]["targets"];

export function enabledSkills(skills: Skill[], targetKey: KnownTarget): Skill[] {
  return skills.filter((skill) => skill.metadata.targets[targetKey]?.enabled === true);
}

export function commandNameForSkill(skill: Skill, targetKey: "opencode" | "gemini"): string {
  return skill.metadata.target_overrides?.[targetKey]?.command_name ?? skill.id;
}

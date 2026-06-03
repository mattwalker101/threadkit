import { MANAGED_MARKER_TOKEN } from "./marker.js";
import type { RenderInput, RenderResult, Renderer } from "./renderTypes.js";

const DESCRIPTION_LIMIT = 1024;
const DESCRIPTION_TRUNCATE_AT = 1021;

type KnownTarget = keyof RenderInput["skills"][number]["metadata"]["targets"];

function asKnownTarget(target: string): KnownTarget {
  return target as KnownTarget;
}

function descriptionForSkill(
  skill: RenderInput["skills"][number],
  target: string
): { description: string; warning?: string } {
  const targetKey = asKnownTarget(target);
  const override = skill.metadata.target_overrides?.[targetKey]?.description;
  const description = override ?? skill.metadata.summary;

  if (description.length <= DESCRIPTION_LIMIT) {
    return { description };
  }

  return {
    description: `${description.slice(0, DESCRIPTION_TRUNCATE_AT)}...`,
    warning: `Skill '${skill.id}' description for target '${target}' exceeded 1024 characters and was truncated.`
  };
}

function renderSkillFile(input: RenderInput, skill: RenderInput["skills"][number]): { content: string; warning?: string } {
  const { description, warning } = descriptionForSkill(skill, input.target);
  const marker = `<!-- ${MANAGED_MARKER_TOKEN} target=${input.target} profile=${input.profile} skill=${skill.id} -->`;
  const body = skill.body.trimEnd();
  const content = [
    "---",
    `name: ${skill.id}`,
    `description: ${description}`,
    "---",
    marker,
    "",
    body,
    ""
  ].join("\n");

  return { content, warning };
}

export function renderSkill(input: RenderInput): RenderResult {
  const files = [];
  const warnings: string[] = [];
  const targetKey = asKnownTarget(input.target);

  for (const skill of input.skills) {
    const enabled = skill.metadata.targets[targetKey]?.enabled === true;

    if (!enabled) {
      continue;
    }

    const result = renderSkillFile(input, skill);

    if (result.warning !== undefined) {
      warnings.push(result.warning);
    }

    files.push({
      relPath: `${input.target}/skills/${skill.id}/SKILL.md`,
      content: result.content,
      marker: true
    });
  }

  return {
    format: "skill",
    files,
    warnings
  };
}

export const skillRenderer: Renderer = {
  render: renderSkill
};

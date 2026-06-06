import { enabledSkills, renderSkillPayloadFiles, type KnownTarget } from "./renderHelpers.js";
import { MANAGED_MARKER_TOKEN } from "./marker.js";
import type { RenderInput, RenderResult, Renderer } from "./renderTypes.js";

const DESCRIPTION_LIMIT = 1024;
const DESCRIPTION_TRUNCATE_AT = 1021;

function descriptionForSkill(
  skill: RenderInput["skills"][number],
  targetKey: KnownTarget
): { description: string; warning?: string } {
  const override = skill.metadata.target_overrides?.[targetKey]?.description;
  const description = override ?? skill.metadata.summary;

  if (description.length <= DESCRIPTION_LIMIT) {
    return { description };
  }

  return {
    description: `${description.slice(0, DESCRIPTION_TRUNCATE_AT)}...`,
    warning: `Skill '${skill.id}' description for target '${targetKey}' exceeded 1024 characters and was truncated.`
  };
}

function renderSkillFile(input: RenderInput, skill: RenderInput["skills"][number], targetKey: KnownTarget): { content: string; warning?: string } {
  const { description, warning } = descriptionForSkill(skill, targetKey);
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
  const targetKey = input.target as KnownTarget;

  for (const skill of enabledSkills(input.skills, targetKey)) {
    const result = renderSkillFile(input, skill, targetKey);

    if (result.warning !== undefined) {
      warnings.push(result.warning);
    }

    files.push({
      relPath: `${input.target}/skills/${skill.id}/SKILL.md`,
      content: result.content,
      marker: true
    });
  }

  files.push(
    ...renderSkillPayloadFiles({
      skills: input.skills,
      targetKey,
      relPathForPayload: ({ skill, payloadDir, payloadRelPath }) =>
        `${input.target}/skills/${skill.id}/${payloadDir}/${payloadRelPath}`
    })
  );

  return {
    format: "skill",
    files,
    warnings
  };
}

export const skillRenderer: Renderer = {
  render: renderSkill
};

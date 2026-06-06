import { enabledSkills, renderSkillPayloadFiles } from "./renderHelpers.js";
import { MANAGED_MARKER_TOKEN } from "./marker.js";
import type { RenderInput, RenderResult, Renderer } from "./renderTypes.js";

function renderSkillSection(skill: RenderInput["skills"][number]): string {
  const triggers = skill.metadata.triggers.map((trigger) => `- ${trigger}`).join("\n");
  const body = skill.body.trimEnd();

  return [`## ${skill.metadata.name}`, "", `Summary: ${skill.metadata.summary}`, "", "Triggers:", triggers, "", body].join("\n");
}

export function renderMarkdown(input: RenderInput): RenderResult {
  const marker = `<!-- ${MANAGED_MARKER_TOKEN} target=markdown profile=${input.profile} -->`;
  const sections = enabledSkills(input.skills, "markdown").map(renderSkillSection);

  const content = [`# ${input.profile}`, "", marker, "", ...sections].join("\n").trimEnd() + "\n";

  const payloadFiles = renderSkillPayloadFiles({
    skills: input.skills,
    targetKey: "markdown",
    relPathForPayload: ({ skill, payloadDir, payloadRelPath }) =>
      `markdown/skills/${skill.id}/${payloadDir}/${payloadRelPath}`
  });

  return {
    format: "markdown",
    files: [
      {
        relPath: `markdown/${input.profile}.md`,
        content,
        marker: true
      },
      ...payloadFiles
    ],
    warnings: []
  };
}

export const markdownRenderer: Renderer = {
  render: renderMarkdown
};

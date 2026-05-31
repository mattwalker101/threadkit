import type { RenderInput, RenderResult, Renderer } from "./renderTypes.js";

function renderSkillSection(skill: RenderInput["skills"][number]): string {
  const triggers = skill.metadata.triggers.map((trigger) => `- ${trigger}`).join("\n");
  const body = skill.body.trimEnd();

  return [`## ${skill.metadata.name}`, "", `Summary: ${skill.metadata.summary}`, "", "Triggers:", triggers, "", body].join("\n");
}

export function renderMarkdown(input: RenderInput): RenderResult {
  const marker = `<!-- threadkit:generated target=markdown profile=${input.profile} -->`;
  const sections = input.skills
    .filter((skill) => skill.metadata.targets.markdown?.enabled === true)
    .map((skill) => renderSkillSection(skill));

  const content = [`# ${input.profile}`, "", marker, "", ...sections].join("\n").trimEnd() + "\n";

  return {
    format: "markdown",
    files: [
      {
        relPath: `markdown/${input.profile}.md`,
        content,
        marker: true
      }
    ],
    warnings: []
  };
}

export const markdownRenderer: Renderer = {
  render: renderMarkdown
};

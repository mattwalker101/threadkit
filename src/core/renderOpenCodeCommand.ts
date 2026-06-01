import type { RenderInput, RenderResult, Renderer } from "./renderTypes.js";

function commandNameForSkill(skill: RenderInput["skills"][number]): string {
  return skill.metadata.target_overrides?.opencode?.command_name ?? skill.id;
}

function renderCommandFile(input: RenderInput, skill: RenderInput["skills"][number]): string {
  const marker = `<!-- threadkit:generated target=${input.target} profile=${input.profile} skill=${skill.id} -->`;
  const body = skill.body.trimEnd();

  return ["---", `description: ${skill.metadata.summary}`, "---", marker, "", body, ""].join("\n");
}

export function renderOpenCodeCommand(input: RenderInput): RenderResult {
  const files = input.skills
    .filter((skill) => skill.metadata.targets.opencode?.enabled === true)
    .map((skill) => ({
      relPath: `opencode/command/${commandNameForSkill(skill)}.md`,
      content: renderCommandFile(input, skill),
      marker: true
    }));

  return {
    format: "opencode-command",
    files,
    warnings: []
  };
}

export const openCodeCommandRenderer: Renderer = {
  render: renderOpenCodeCommand
};

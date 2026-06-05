import { commandNameForSkill, enabledSkills } from "./renderHelpers.js";
import { MANAGED_MARKER_TOKEN } from "./marker.js";
import type { RenderInput, RenderResult, Renderer } from "./renderTypes.js";

function renderCommandFile(input: RenderInput, skill: RenderInput["skills"][number]): string {
  const marker = `<!-- ${MANAGED_MARKER_TOKEN} target=${input.target} profile=${input.profile} skill=${skill.id} -->`;
  const body = skill.body.trimEnd();

  return ["---", `description: ${skill.metadata.summary}`, "---", marker, "", body, ""].join("\n");
}

export function renderOpenCodeCommand(input: RenderInput): RenderResult {
  const files = enabledSkills(input.skills, "opencode").map((skill) => ({
      relPath: `opencode/command/${commandNameForSkill(skill, "opencode")}.md`,
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

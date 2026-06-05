import { enabledSkills } from "./renderHelpers.js";
import { MANAGED_MARKER_TOKEN } from "./marker.js";
import type { RenderInput, RenderResult, Renderer } from "./renderTypes.js";

function renderSkillSection(skill: RenderInput["skills"][number]): string {
  const body = skill.body.trimEnd();

  return [`## ${skill.metadata.name}`, "", `Summary: ${skill.metadata.summary}`, "", body].join("\n");
}

export function renderAgentsMd(input: RenderInput): RenderResult {
  const marker = `<!-- ${MANAGED_MARKER_TOKEN} target=${input.target} profile=${input.profile} -->`;
  const sections = enabledSkills(input.skills, "codex").map(renderSkillSection);
  const content = [`# ${input.profile}`, "", marker, "", ...sections].join("\n").trimEnd() + "\n";

  return {
    format: "agents-md",
    files: [
      {
        relPath: "codex/AGENTS.md",
        content,
        marker: true
      }
    ],
    warnings: []
  };
}

export const agentsMdRenderer: Renderer = {
  render: renderAgentsMd
};

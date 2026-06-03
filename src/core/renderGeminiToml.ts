import { stringify } from "@iarna/toml";
import { MANAGED_MARKER_TOKEN } from "./marker.js";
import type { RenderInput, RenderResult, Renderer } from "./renderTypes.js";

function commandNameForSkill(skill: RenderInput["skills"][number]): string {
  return skill.metadata.target_overrides?.gemini?.command_name ?? skill.id;
}

function renderCommandFile(input: RenderInput, skill: RenderInput["skills"][number]): string {
  const marker = `# ${MANAGED_MARKER_TOKEN} target=${input.target} profile=${input.profile} skill=${skill.id}`;
  const body = skill.body.trimEnd();

  return stringify({
    description: skill.metadata.summary,
    prompt: `${marker}\n\n${body}\n`
  });
}

export function renderGeminiToml(input: RenderInput): RenderResult {
  const files = input.skills
    .filter((skill) => skill.metadata.targets.gemini?.enabled === true)
    .map((skill) => ({
      relPath: `gemini/commands/${commandNameForSkill(skill)}.toml`,
      content: renderCommandFile(input, skill),
      marker: true
    }));

  return {
    format: "gemini-toml",
    files,
    warnings: []
  };
}

export const geminiTomlRenderer: Renderer = {
  render: renderGeminiToml
};

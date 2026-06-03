import { stringify } from "@iarna/toml";
import { commandNameForSkill, enabledSkills } from "./renderHelpers.js";
import { MANAGED_MARKER_TOKEN } from "./marker.js";
import type { RenderInput, RenderResult, Renderer } from "./renderTypes.js";

function renderCommandFile(input: RenderInput, skill: RenderInput["skills"][number]): string {
  const marker = `# ${MANAGED_MARKER_TOKEN} target=${input.target} profile=${input.profile} skill=${skill.id}`;
  const body = skill.body.trimEnd();

  return stringify({
    description: skill.metadata.summary,
    prompt: `${marker}\n\n${body}\n`
  });
}

export function renderGeminiToml(input: RenderInput): RenderResult {
  const files = enabledSkills(input.skills, "gemini").map((skill) => ({
      relPath: `gemini/commands/${commandNameForSkill(skill, "gemini")}.toml`,
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

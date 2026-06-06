import { commandNameForSkill, enabledSkills, renderSkillPayloadFiles } from "./renderHelpers.js";
import { MANAGED_MARKER_TOKEN } from "./marker.js";
import type { FileSpec, RenderInput, RenderResult, Renderer } from "./renderTypes.js";

function renderCommandFile(input: RenderInput, skill: RenderInput["skills"][number]): string {
  const marker = `<!-- ${MANAGED_MARKER_TOKEN} target=${input.target} profile=${input.profile} skill=${skill.id} -->`;
  const body = skill.body.trimEnd();

  return ["---", `description: ${skill.metadata.summary}`, "---", marker, "", body, ""].join("\n");
}

export function renderOpenCodeCommand(input: RenderInput): RenderResult {
  const files: FileSpec[] = enabledSkills(input.skills, "opencode").map((skill) => ({
      relPath: `opencode/command/${commandNameForSkill(skill, "opencode")}.md`,
      content: renderCommandFile(input, skill),
      marker: true
    }));
  files.push(
    ...renderSkillPayloadFiles({
      skills: input.skills,
      targetKey: "opencode",
      relPathForPayload: ({ skill, payloadDir, payloadRelPath }) =>
        `opencode/command/${commandNameForSkill(skill, "opencode")}/${payloadDir}/${payloadRelPath}`
    })
  );

  return {
    format: "opencode-command",
    files,
    warnings: []
  };
}

export const openCodeCommandRenderer: Renderer = {
  render: renderOpenCodeCommand
};

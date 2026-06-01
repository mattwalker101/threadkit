import { describe, expect, it } from "vitest";
import type { LoadedSkill } from "../src/core/index.js";
import { renderOpenCodeCommand } from "../src/core/renderOpenCodeCommand.js";

function skill(args: {
  id: string;
  name?: string;
  summary?: string;
  body?: string;
  opencode?: boolean;
  commandName?: string;
}): LoadedSkill {
  return {
    id: args.id,
    dir: `/root/skills/${args.id}`,
    metadata: {
      id: args.id,
      name: args.name ?? args.id,
      version: "0.1.0",
      status: "draft",
      summary: args.summary ?? `Summary for ${args.id}.`,
      category: "testing",
      triggers: [`use ${args.id}`, `run ${args.id}`],
      profiles: ["minimal"],
      targets: {
        opencode: { enabled: args.opencode ?? true }
      },
      safety: {
        allow_shell_commands: false,
        allow_network: false,
        allow_file_writes: false,
        includes_scripts: false
      },
      tags: [],
      target_overrides:
        args.commandName === undefined
          ? undefined
          : {
              opencode: {
                command_name: args.commandName
              }
            }
    },
    body: args.body ?? `# ${args.id}\n\nBody for ${args.id}.\n`
  };
}

describe("opencode command renderer", () => {
  it("renders deterministic command files in profile order", () => {
    const input = {
      profile: "minimal",
      target: "opencode",
      scope: "user" as const,
      skills: [
        skill({ id: "zeta", summary: "Zeta summary." }),
        skill({ id: "alpha", summary: "Alpha summary." })
      ]
    };

    const first = renderOpenCodeCommand(input);
    const second = renderOpenCodeCommand(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      format: "opencode-command",
      warnings: []
    });
    expect(first.files.map((file) => file.relPath)).toEqual([
      "opencode/command/zeta.md",
      "opencode/command/alpha.md"
    ]);
  });

  it("filters by opencode target flag and writes skill-specific markers", () => {
    const result = renderOpenCodeCommand({
      profile: "minimal",
      target: "opencode",
      scope: "user",
      skills: [
        skill({ id: "enabled", opencode: true }),
        skill({ id: "disabled", opencode: false })
      ]
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      relPath: "opencode/command/enabled.md",
      marker: true
    });
    expect(result.files[0].content).toContain(
      "<!-- threadkit:generated target=opencode profile=minimal skill=enabled -->"
    );
    expect(result.files[0].content).not.toContain("/root");
    expect(result.files[0].content).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("uses command_name overrides for filenames", () => {
    const result = renderOpenCodeCommand({
      profile: "minimal",
      target: "opencode",
      scope: "user",
      skills: [skill({ id: "handoff", commandName: "handoff-notes" })]
    });

    expect(result.files[0].relPath).toBe("opencode/command/handoff-notes.md");
  });

  it("emits description frontmatter, marker, and body", () => {
    const result = renderOpenCodeCommand({
      profile: "minimal",
      target: "opencode",
      scope: "user",
      skills: [
        skill({
          id: "handoff",
          summary: "Creates a handoff.",
          body: "# Handoff\n\nUse this skill.\n"
        })
      ]
    });

    expect(result.files[0].content).toBe(
      [
        "---",
        "description: Creates a handoff.",
        "---",
        "<!-- threadkit:generated target=opencode profile=minimal skill=handoff -->",
        "",
        "# Handoff",
        "",
        "Use this skill.",
        ""
      ].join("\n")
    );
  });
});

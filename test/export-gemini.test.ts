import { parse } from "@iarna/toml";
import { describe, expect, it } from "vitest";
import type { LoadedSkill } from "../src/core/index.js";
import { renderGeminiToml } from "../src/core/renderGeminiToml.js";

function skill(args: {
  id: string;
  name?: string;
  summary?: string;
  body?: string;
  gemini?: boolean;
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
        gemini: { enabled: args.gemini ?? true }
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
              gemini: {
                command_name: args.commandName
              }
            }
    },
    body: args.body ?? `# ${args.id}\n\nBody for ${args.id}.\n`
  };
}

describe("gemini toml renderer", () => {
  it("renders deterministic command files in profile order", () => {
    const input = {
      profile: "minimal",
      target: "gemini",
      scope: "user" as const,
      skills: [
        skill({ id: "zeta", summary: "Zeta summary." }),
        skill({ id: "alpha", summary: "Alpha summary." })
      ]
    };

    const first = renderGeminiToml(input);
    const second = renderGeminiToml(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      format: "gemini-toml",
      warnings: []
    });
    expect(first.files.map((file) => file.relPath)).toEqual([
      "gemini/commands/zeta.toml",
      "gemini/commands/alpha.toml"
    ]);
  });

  it("filters by gemini target flag and writes skill-specific markers", () => {
    const result = renderGeminiToml({
      profile: "minimal",
      target: "gemini",
      scope: "user",
      skills: [
        skill({ id: "enabled", gemini: true }),
        skill({ id: "disabled", gemini: false })
      ]
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      relPath: "gemini/commands/enabled.toml",
      marker: true
    });
    expect(result.files[0].content).toContain(
      "# threadkit:generated target=gemini profile=minimal skill=enabled"
    );
    expect(result.files[0].content).not.toContain("/root");
    expect(result.files[0].content).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("uses command_name overrides for filenames", () => {
    const result = renderGeminiToml({
      profile: "minimal",
      target: "gemini",
      scope: "user",
      skills: [skill({ id: "handoff", commandName: "handoff-notes" })]
    });

    expect(result.files[0].relPath).toBe("gemini/commands/handoff-notes.toml");
  });

  it("emits parseable TOML with description, marker, and body", () => {
    const result = renderGeminiToml({
      profile: "minimal",
      target: "gemini",
      scope: "user",
      skills: [
        skill({
          id: "handoff",
          summary: "Creates a handoff.",
          body: "# Handoff\n\nUse this skill.\n"
        })
      ]
    });

    expect(parse(result.files[0].content ?? "")).toEqual({
      description: "Creates a handoff.",
      prompt: [
        "# threadkit:generated target=gemini profile=minimal skill=handoff",
        "",
        "# Handoff",
        "",
        "Use this skill.",
        ""
      ].join("\n")
    });
  });

  it("serializes multiline prompts with TOML escaping", () => {
    const result = renderGeminiToml({
      profile: "minimal",
      target: "gemini",
      scope: "user",
      skills: [
        skill({
          id: "escaping",
          summary: 'Handles "quoted" summaries.',
          body: 'Line one\nLine with "quotes" and backslash \\\n'
        })
      ]
    });

    expect(parse(result.files[0].content ?? "")).toEqual({
      description: 'Handles "quoted" summaries.',
      prompt: [
        "# threadkit:generated target=gemini profile=minimal skill=escaping",
        "",
        "Line one",
        'Line with "quotes" and backslash \\',
        ""
      ].join("\n")
    });
  });
});

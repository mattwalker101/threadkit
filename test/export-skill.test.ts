import { describe, expect, it } from "vitest";
import type { LoadedSkill } from "../src/core/index.js";
import { renderSkill } from "../src/core/renderSkill.js";

function skill(args: {
  id: string;
  name?: string;
  summary?: string;
  body?: string;
  claude?: boolean;
  antigravity?: boolean;
  overrideDescription?: string;
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
        claude: { enabled: args.claude ?? true },
        antigravity: { enabled: args.antigravity ?? true },
        markdown: { enabled: true }
      },
      safety: {
        allow_shell_commands: false,
        allow_network: false,
        allow_file_writes: false,
        includes_scripts: false
      },
      tags: [],
      target_overrides:
        args.overrideDescription === undefined
          ? undefined
          : {
              claude: {
                description: args.overrideDescription
              }
            }
    },
    body: args.body ?? `# ${args.id}\n\nBody for ${args.id}.\n`
  };
}

describe("skill renderer", () => {
  it("renders deterministic SKILL.md files in profile order", () => {
    const input = {
      profile: "minimal",
      target: "claude",
      scope: "user" as const,
      skills: [
        skill({ id: "zeta", summary: "Zeta summary." }),
        skill({ id: "alpha", summary: "Alpha summary." })
      ]
    };

    const first = renderSkill(input);
    const second = renderSkill(input);

    expect(first).toEqual(second);
    expect(first.format).toBe("skill");
    expect(first.warnings).toEqual([]);
    expect(first.files.map((file) => file.relPath)).toEqual([
      "claude/skills/zeta/SKILL.md",
      "claude/skills/alpha/SKILL.md"
    ]);
  });

  it("filters by target flag and writes target-specific markers", () => {
    const result = renderSkill({
      profile: "minimal",
      target: "antigravity",
      scope: "user",
      skills: [
        skill({ id: "enabled", antigravity: true }),
        skill({ id: "disabled", antigravity: false })
      ]
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      relPath: "antigravity/skills/enabled/SKILL.md",
      marker: true
    });
    expect(result.files[0].content).toContain(
      "<!-- threadkit:generated target=antigravity profile=minimal skill=enabled -->"
    );
    expect(result.files[0].content).not.toContain("/root");
    expect(result.files[0].content).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("uses target override descriptions before summary", () => {
    const result = renderSkill({
      profile: "minimal",
      target: "claude",
      scope: "user",
      skills: [
        skill({
          id: "handoff",
          summary: "Summary description.",
          overrideDescription: "Override description."
        })
      ]
    });

    expect(result.files[0].content).toContain("description: Override description.");
    expect(result.files[0].content).not.toContain("description: Summary description.");
  });

  it("places the marker immediately after frontmatter and appends the body", () => {
    const result = renderSkill({
      profile: "minimal",
      target: "claude",
      scope: "user",
      skills: [skill({ id: "handoff", body: "# Handoff\n\nUse this skill.\n" })]
    });

    expect(result.files[0].content).toBe(
      [
        "---",
        "name: handoff",
        "description: Summary for handoff.",
        "---",
        "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->",
        "",
        "# Handoff",
        "",
        "Use this skill.",
        ""
      ].join("\n")
    );
  });

  it("truncates overlong descriptions and emits a warning", () => {
    const longDescription = "a".repeat(1025);
    const result = renderSkill({
      profile: "minimal",
      target: "claude",
      scope: "user",
      skills: [skill({ id: "verbose", overrideDescription: longDescription })]
    });

    const descriptionLine = result.files[0].content?.split("\n")[2];

    expect(descriptionLine).toBe(`description: ${"a".repeat(1021)}...`);
    expect(result.warnings).toEqual([
      "Skill 'verbose' description for target 'claude' exceeded 1024 characters and was truncated."
    ]);
  });
});

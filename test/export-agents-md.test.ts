import { describe, expect, it } from "vitest";
import type { LoadedSkill } from "../src/core/index.js";
import { renderAgentsMd } from "../src/core/renderAgentsMd.js";

function skill(args: {
  id: string;
  name?: string;
  summary?: string;
  body?: string;
  codex?: boolean;
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
        codex: { enabled: args.codex ?? true }
      },
      safety: {
        allow_shell_commands: false,
        allow_network: false,
        allow_file_writes: false,
        includes_scripts: false
      },
      tags: []
    },
    body: args.body ?? `# ${args.id}\n\nBody for ${args.id}.\n`
  };
}

describe("agents-md renderer", () => {
  it("renders one deterministic AGENTS.md file in profile order", () => {
    const input = {
      profile: "minimal",
      target: "codex",
      scope: "user" as const,
      skills: [
        skill({ id: "zeta", name: "Zeta", summary: "Last summary." }),
        skill({ id: "alpha", name: "Alpha", summary: "First summary." })
      ]
    };

    const first = renderAgentsMd(input);
    const second = renderAgentsMd(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      format: "agents-md",
      warnings: []
    });
    expect(first.files).toHaveLength(1);
    expect(first.files[0]).toMatchObject({
      relPath: "codex/AGENTS.md",
      marker: true
    });
    expect(first.files[0].content).toContain("# minimal\n\n<!-- threadkit:generated target=codex profile=minimal -->");
    expect(first.files[0].content.indexOf("## Zeta")).toBeLessThan(first.files[0].content.indexOf("## Alpha"));
  });

  it("filters by codex target flag and emits one global marker", () => {
    const result = renderAgentsMd({
      profile: "minimal",
      target: "codex",
      scope: "user",
      skills: [
        skill({ id: "enabled", name: "Enabled", codex: true }),
        skill({ id: "disabled", name: "Disabled", codex: false })
      ]
    });

    const content = result.files[0].content ?? "";

    expect(content).toContain("## Enabled");
    expect(content).not.toContain("## Disabled");
    expect(content.match(/threadkit:generated/g)).toHaveLength(1);
    expect(content).toContain("<!-- threadkit:generated target=codex profile=minimal -->");
    expect(content).not.toContain("/root");
    expect(content).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("includes summaries and instruction bodies without trigger blocks", () => {
    const result = renderAgentsMd({
      profile: "minimal",
      target: "codex",
      scope: "user",
      skills: [
        skill({
          id: "handoff",
          name: "Handoff",
          summary: "Creates a handoff.",
          body: "Use this skill when handing off work.\n"
        })
      ]
    });

    expect(result.files[0].content).toBe(
      [
        "# minimal",
        "",
        "<!-- threadkit:generated target=codex profile=minimal -->",
        "",
        "## Handoff",
        "",
        "Summary: Creates a handoff.",
        "",
        "Use this skill when handing off work.",
        ""
      ].join("\n")
    );
    expect(result.files[0].content).not.toContain("Triggers:");
  });
});

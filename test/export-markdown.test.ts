import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LoadedSkill } from "../src/core/index.js";
import { renderMarkdown } from "../src/core/renderMarkdown.js";
import { writeExportFiles } from "../src/core/writeExportFiles.js";

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "threadkit-export-"));
}

function skill(args: {
  id: string;
  dir?: string;
  name?: string;
  summary?: string;
  triggers?: string[];
  body?: string;
  markdown?: boolean;
}): LoadedSkill {
  return {
    id: args.id,
    dir: args.dir ?? join(process.cwd(), ".missing-test-skills", args.id),
    metadata: {
      id: args.id,
      name: args.name ?? args.id,
      version: "0.1.0",
      status: "draft",
      summary: args.summary ?? `Summary for ${args.id}.`,
      category: "testing",
      triggers: args.triggers ?? [`use ${args.id}`, `run ${args.id}`],
      profiles: ["minimal"],
      targets: {
        markdown: { enabled: args.markdown ?? true }
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

describe("markdown renderer", () => {
  it("renders deterministic markdown in profile order", () => {
    const input = {
      profile: "minimal",
      target: "markdown",
      scope: "user" as const,
      skills: [
        skill({ id: "zeta", name: "Zeta", summary: "Last summary." }),
        skill({ id: "alpha", name: "Alpha", summary: "First summary." })
      ]
    };

    const first = renderMarkdown(input);
    const second = renderMarkdown(input);

    expect(first).toEqual(second);
    expect(first.files).toHaveLength(1);
    expect(first.files[0]).toMatchObject({
      relPath: "markdown/minimal.md",
      marker: true
    });
    expect(first.files[0].content).toContain("# minimal\n\n<!-- threadkit:generated target=markdown profile=minimal -->");
    expect(first.files[0].content.indexOf("## Zeta")).toBeLessThan(first.files[0].content.indexOf("## Alpha"));
  });

  it("excludes skills disabled for markdown and emits one deterministic marker", () => {
    const result = renderMarkdown({
      profile: "minimal",
      target: "markdown",
      scope: "user",
      skills: [
        skill({ id: "enabled", name: "Enabled", markdown: true }),
        skill({ id: "disabled", name: "Disabled", markdown: false })
      ]
    });

    const content = result.files[0].content;

    expect(content).toContain("## Enabled");
    expect(content).not.toContain("## Disabled");
    expect(content.match(/threadkit:generated/g)).toHaveLength(1);
    expect(content).toContain("<!-- threadkit:generated target=markdown profile=minimal -->");
    expect(content).not.toContain("/root");
    expect(content).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("includes summaries, triggers, and body content", () => {
    const result = renderMarkdown({
      profile: "minimal",
      target: "markdown",
      scope: "user",
      skills: [
        skill({
          id: "handoff",
          name: "Handoff",
          summary: "Creates a handoff.",
          triggers: ["create a handoff", "write handoff notes"],
          body: "Use this skill when handing off work.\n"
        })
      ]
    });

    expect(result.files[0].content).toContain("Summary: Creates a handoff.");
    expect(result.files[0].content).toContain("Triggers:\n- create a handoff\n- write handoff notes");
    expect(result.files[0].content).toContain("Use this skill when handing off work.");
  });

  it("includes markdown payload files in skill-scoped folders next to the aggregate file", async () => {
    const root = await makeTempRoot();
    const skillDir = join(root, "skills", "payload");
    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await writeFile(join(skillDir, "scripts", "run.sh"), "echo run\n");

    const result = renderMarkdown({
      profile: "minimal",
      target: "markdown",
      scope: "user",
      skills: [skill({ id: "payload", dir: skillDir })]
    });

    expect(result.files.map((file) => file.relPath)).toEqual([
      "markdown/minimal.md",
      "markdown/skills/payload/scripts/run.sh"
    ]);
    expect(result.files[1]).toEqual({
      relPath: "markdown/skills/payload/scripts/run.sh",
      copySource: join(skillDir, "scripts", "run.sh"),
      marker: true
    });
  });
});

describe("export writer", () => {
  it("writes nested relative paths under the output root and reports byte counts", async () => {
    const root = await makeTempRoot();

    const files = await writeExportFiles({
      outDir: root,
      files: [
        {
          relPath: "markdown/minimal.md",
          content: "# minimal\n",
          marker: true
        }
      ]
    });

    expect(await readFile(join(root, "markdown", "minimal.md"), "utf8")).toBe("# minimal\n");
    expect(files).toEqual([
      {
        path: join(root, "markdown", "minimal.md"),
        relPath: "markdown/minimal.md",
        marker: true,
        bytes: Buffer.byteLength("# minimal\n")
      }
    ]);
  });

  it("copies file specs from copySource", async () => {
    const root = await makeTempRoot();
    const sourceRoot = await makeTempRoot();
    const sourcePath = join(sourceRoot, "template.txt");
    await writeFile(sourcePath, "asset\n");

    const files = await writeExportFiles({
      outDir: root,
      files: [
        {
          relPath: "markdown/skills/payload/assets/template.txt",
          copySource: sourcePath,
          marker: true
        }
      ]
    });

    expect(await readFile(join(root, "markdown", "skills", "payload", "assets", "template.txt"), "utf8")).toBe(
      "asset\n"
    );
    expect(files).toEqual([
      {
        path: join(root, "markdown", "skills", "payload", "assets", "template.txt"),
        relPath: "markdown/skills/payload/assets/template.txt",
        marker: true,
        bytes: Buffer.byteLength("asset\n")
      }
    ]);
  });

  it("rejects file specs that would escape the output root", async () => {
    const root = await makeTempRoot();

    await expect(
      writeExportFiles({
        outDir: root,
        files: [{ relPath: "../escape.md", content: "nope", marker: false }]
      })
    ).rejects.toThrow("Export file path '../escape.md' escapes the base directory.");
  });
});

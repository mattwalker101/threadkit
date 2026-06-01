import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/index.js";

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "threadkit-cli-"));
}

const validSkillYml = `id: handoff
name: Handoff
version: 0.1.0
status: draft
summary: Creates a handoff document.
category: coordination
triggers:
  - create a handoff
  - write a handoff document
profiles:
  - minimal
targets:
  claude:
    enabled: true
  antigravity:
    enabled: true
  codex:
    enabled: true
  opencode:
    enabled: true
  gemini:
    enabled: true
  markdown:
    enabled: true
safety:
  allow_shell_commands: false
  allow_network: false
  allow_file_writes: true
  includes_scripts: false
tags: []
`;

const validProfileYml = `name: minimal
description: Smallest useful baseline.
skills:
  - handoff
`;

async function writeValidCustomLibrary(root: string): Promise<void> {
  await mkdir(join(root, "skills", "handoff"), { recursive: true });
  await mkdir(join(root, "profiles"), { recursive: true });
  await writeFile(join(root, "skills", "handoff", "skill.yml"), validSkillYml);
  await writeFile(join(root, "skills", "handoff", "body.md"), "# Handoff\n");
  await writeFile(join(root, "profiles", "minimal.yml"), validProfileYml);
}

function makeHarness(cwd = process.cwd()) {
  let stdout = "";
  let stderr = "";
  let exitCode: number | undefined;

  const program = createProgram({
    cwd,
    write: (value) => {
      stdout += value;
    },
    writeError: (value) => {
      stderr += value;
    },
    setExitCode: (code) => {
      exitCode = code;
    }
  });

  program.exitOverride();
  program.configureOutput({
    writeOut: (value) => {
      stdout += value;
    },
    writeErr: (value) => {
      stderr += value;
    }
  });

  return {
    program,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    get exitCode() {
      return exitCode;
    }
  };
}

describe("threadkit CLI", () => {
  it("exposes the program name and version", () => {
    const { program } = makeHarness();

    expect(program.name()).toBe("threadkit");
    expect(program.version()).toBe("0.1.0");
  });

  it("validates the repository library as JSON", async () => {
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "validate", "--format", "json"]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: true,
      root: process.cwd(),
      errors: [],
      warnings: []
    });
  });

  it("validates a custom root without canonical bundled-skill checks", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "validate", "--root", root, "--format", "json"]);

    expect(harness.exitCode).toBe(0);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: true,
      root,
      errors: [],
      warnings: []
    });
  });

  it("reports validation failures as JSON and exits 1", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    await writeFile(join(root, "skills", "handoff", "body.md"), " \n");
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "validate", "--root", root, "--format", "json"]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(1);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: false,
      root,
      errors: [
        {
          code: "validation-error",
          message: "Skill 'handoff' has an empty body.md."
        }
      ],
      warnings: []
    });
  });

  it("lists skill summaries as JSON", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "list", "--root", root, "--format", "json"]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(JSON.parse(harness.stdout)).toEqual({
      ok: true,
      root,
      skills: [
        {
          id: "handoff",
          name: "Handoff",
          summary: "Creates a handoff document.",
          profiles: ["minimal"],
          status: "draft"
        }
      ]
    });
  });

  it("shows a skill as JSON", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "show", "handoff", "--root", root, "--format", "json"]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: true,
      root,
      skill: {
        id: "handoff",
        name: "Handoff",
        version: "0.1.0",
        status: "draft",
        summary: "Creates a handoff document.",
        category: "coordination",
        triggers: ["create a handoff", "write a handoff document"],
        profiles: ["minimal"],
        targets: {
          claude: { enabled: true },
          antigravity: { enabled: true },
          codex: { enabled: true },
          opencode: { enabled: true },
          gemini: { enabled: true },
          markdown: { enabled: true }
        },
        safety: {
          allow_shell_commands: false,
          allow_network: false,
          allow_file_writes: true,
          includes_scripts: false
        },
        tags: [],
        body: "# Handoff\n"
      }
    });
  });

  it("reports a missing skill as a JSON usage fault", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "show", "missing-skill", "--root", root, "--format", "json"]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(2);
    expect(JSON.parse(harness.stdout)).toEqual({
      ok: false,
      root,
      errors: [
        {
          code: "unknown-skill",
          message: "Skill 'missing-skill' was not found."
        }
      ],
      warnings: []
    });
  });

  it("validates with human-readable output", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "validate", "--root", root]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(harness.stdout).toBe(`Library is valid: ${root}\n`);
  });

  it("audits a valid library as JSON without failing on warnings", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    await writeFile(
      join(root, "skills", "handoff", "skill.yml"),
      validSkillYml.replace("  - create a handoff", "  - help")
    );
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "audit", "--root", root, "--format", "json"]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(JSON.parse(harness.stdout)).toEqual({
      ok: true,
      root,
      warnings: [
        {
          code: "missing-output-format-anchor",
          message: "Skill 'handoff' is missing a '## Output format' section.",
          skill: "handoff"
        },
        {
          code: "missing-what-not-to-do-anchor",
          message: "Skill 'handoff' is missing a '## What not to do' section.",
          skill: "handoff"
        },
        {
          code: "weak-trigger",
          message: "Skill 'handoff' has a low-information trigger: 'help'.",
          skill: "handoff"
        }
      ]
    });
  });

  it("maps audit warnings to exit 1 in strict mode without converting warnings to errors", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "audit",
      "--root",
      root,
      "--strict",
      "--format",
      "json"
    ]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(1);
    expect(JSON.parse(harness.stdout)).toEqual({
      ok: true,
      root,
      warnings: [
        {
          code: "missing-output-format-anchor",
          message: "Skill 'handoff' is missing a '## Output format' section.",
          skill: "handoff"
        },
        {
          code: "missing-what-not-to-do-anchor",
          message: "Skill 'handoff' is missing a '## What not to do' section.",
          skill: "handoff"
        }
      ]
    });
  });

  it("reports audit validation failures as JSON and exits 1", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    await writeFile(join(root, "skills", "handoff", "body.md"), " \n");
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "audit", "--root", root, "--format", "json"]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(1);
    expect(JSON.parse(harness.stdout)).toEqual({
      ok: false,
      root,
      errors: [
        {
          code: "validation-error",
          message: "Skill 'handoff' has an empty body.md."
        }
      ],
      warnings: []
    });
  });

  it("audits a clean library with human-readable output", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    await writeFile(
      join(root, "skills", "handoff", "body.md"),
      "# Handoff\n\n## Output format\n\nPlain text.\n\n## What not to do\n\nDo not omit context.\n"
    );
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "audit", "--root", root]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(harness.stdout).toBe(`Library audit passed: ${root}\n`);
  });

  it("lists skills with human-readable output", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "list", "--root", root]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(harness.stdout).toBe("handoff\tHandoff\tCreates a handoff document.\n");
  });

  it("shows a skill with human-readable output", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "show", "handoff", "--root", root]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(harness.stdout).toBe("Handoff (handoff)\n\n# Handoff\n");
  });

  it("exports markdown to the default dist directory", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "export", "markdown", "--profile", "minimal", "--root", root]);

    const output = await readFile(join(root, "dist", "markdown", "minimal.md"), "utf8");
    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(output).toContain("# minimal\n\n<!-- threadkit:generated target=markdown profile=minimal -->");
    expect(output).toContain("## Handoff");
  });

  it("exports markdown to a custom output directory", async () => {
    const root = await makeTempRoot();
    const out = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "export",
      "markdown",
      "--profile",
      "minimal",
      "--root",
      root,
      "--out",
      out
    ]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(await readFile(join(out, "markdown", "minimal.md"), "utf8")).toContain("## Handoff");
  });

  it("reports successful markdown export as JSON", async () => {
    const root = await makeTempRoot();
    const out = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "export",
      "markdown",
      "--profile",
      "minimal",
      "--root",
      root,
      "--out",
      out,
      "--format",
      "json"
    ]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    const output = JSON.parse(harness.stdout);
    expect(output.files[0].relPath).toBe("markdown/minimal.md");
    expect(output).toEqual({
      ok: true,
      root,
      target: "markdown",
      profile: "minimal",
      outDir: out,
      files: [
        {
          path: join(out, "markdown", "minimal.md"),
          relPath: "markdown/minimal.md",
          marker: true,
          bytes: expect.any(Number)
        }
      ],
      warnings: []
    });
  });

  it("exports claude skills to the default dist directory", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "export", "claude", "--profile", "minimal", "--root", root]);

    const output = await readFile(join(root, "dist", "claude", "skills", "handoff", "SKILL.md"), "utf8");
    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(output).toContain("name: handoff");
    expect(output).toContain("description: Creates a handoff document.");
    expect(output).toContain("<!-- threadkit:generated target=claude profile=minimal skill=handoff -->");
    expect(output).toContain("# Handoff");
  });

  it("exports antigravity skills to a custom output directory as JSON", async () => {
    const root = await makeTempRoot();
    const out = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "export",
      "antigravity",
      "--profile",
      "minimal",
      "--root",
      root,
      "--out",
      out,
      "--format",
      "json"
    ]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(await readFile(join(out, "antigravity", "skills", "handoff", "SKILL.md"), "utf8")).toContain(
      "<!-- threadkit:generated target=antigravity profile=minimal skill=handoff -->"
    );
    expect(JSON.parse(harness.stdout)).toEqual({
      ok: true,
      root,
      target: "antigravity",
      profile: "minimal",
      outDir: out,
      files: [
        {
          path: join(out, "antigravity", "skills", "handoff", "SKILL.md"),
          relPath: "antigravity/skills/handoff/SKILL.md",
          marker: true,
          bytes: expect.any(Number)
        }
      ],
      warnings: []
    });
  });

  it("exports codex AGENTS.md to the default dist directory", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "export", "codex", "--profile", "minimal", "--root", root]);

    const output = await readFile(join(root, "dist", "codex", "AGENTS.md"), "utf8");
    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(output).toContain("# minimal\n\n<!-- threadkit:generated target=codex profile=minimal -->");
    expect(output).toContain("## Handoff");
    expect(output).toContain("Summary: Creates a handoff document.");
    expect(output).toContain("# Handoff");
  });

  it("exports codex AGENTS.md to a custom output directory as JSON", async () => {
    const root = await makeTempRoot();
    const out = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "export",
      "codex",
      "--profile",
      "minimal",
      "--root",
      root,
      "--out",
      out,
      "--format",
      "json"
    ]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(await readFile(join(out, "codex", "AGENTS.md"), "utf8")).toContain(
      "<!-- threadkit:generated target=codex profile=minimal -->"
    );
    expect(JSON.parse(harness.stdout)).toEqual({
      ok: true,
      root,
      target: "codex",
      profile: "minimal",
      outDir: out,
      files: [
        {
          path: join(out, "codex", "AGENTS.md"),
          relPath: "codex/AGENTS.md",
          marker: true,
          bytes: expect.any(Number)
        }
      ],
      warnings: []
    });
  });

  it("exports opencode commands to the default dist directory", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "export", "opencode", "--profile", "minimal", "--root", root]);

    const output = await readFile(join(root, "dist", "opencode", "command", "handoff.md"), "utf8");
    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(output).toContain("description: Creates a handoff document.");
    expect(output).toContain("<!-- threadkit:generated target=opencode profile=minimal skill=handoff -->");
    expect(output).toContain("# Handoff");
  });

  it("exports opencode commands to a custom output directory as JSON", async () => {
    const root = await makeTempRoot();
    const out = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "export",
      "opencode",
      "--profile",
      "minimal",
      "--root",
      root,
      "--out",
      out,
      "--format",
      "json"
    ]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(await readFile(join(out, "opencode", "command", "handoff.md"), "utf8")).toContain(
      "<!-- threadkit:generated target=opencode profile=minimal skill=handoff -->"
    );
    expect(JSON.parse(harness.stdout)).toEqual({
      ok: true,
      root,
      target: "opencode",
      profile: "minimal",
      outDir: out,
      files: [
        {
          path: join(out, "opencode", "command", "handoff.md"),
          relPath: "opencode/command/handoff.md",
          marker: true,
          bytes: expect.any(Number)
        }
      ],
      warnings: []
    });
  });

  it("exports gemini commands to the default dist directory", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "export", "gemini", "--profile", "minimal", "--root", root]);

    const output = await readFile(join(root, "dist", "gemini", "commands", "handoff.toml"), "utf8");
    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(output).toContain('description = "Creates a handoff document."');
    expect(output).toContain("# threadkit:generated target=gemini profile=minimal skill=handoff");
    expect(output).toContain("# Handoff");
  });

  it("exports gemini commands to a custom output directory as JSON", async () => {
    const root = await makeTempRoot();
    const out = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "export",
      "gemini",
      "--profile",
      "minimal",
      "--root",
      root,
      "--out",
      out,
      "--format",
      "json"
    ]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(await readFile(join(out, "gemini", "commands", "handoff.toml"), "utf8")).toContain(
      "# threadkit:generated target=gemini profile=minimal skill=handoff"
    );
    expect(JSON.parse(harness.stdout)).toEqual({
      ok: true,
      root,
      target: "gemini",
      profile: "minimal",
      outDir: out,
      files: [
        {
          path: join(out, "gemini", "commands", "handoff.toml"),
          relPath: "gemini/commands/handoff.toml",
          marker: true,
          bytes: expect.any(Number)
        }
      ],
      warnings: []
    });
  });

  it("reports unknown profiles as JSON usage faults", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "export",
      "markdown",
      "--profile",
      "missing",
      "--root",
      root,
      "--format",
      "json"
    ]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(2);
    expect(JSON.parse(harness.stdout)).toEqual({
      ok: false,
      root,
      target: "markdown",
      profile: "missing",
      errors: [
        {
          code: "unknown-profile",
          message: "Profile 'missing' was not found."
        }
      ],
      warnings: []
    });
  });

  it("reports unsupported export targets as usage faults", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "export",
      "unknown-target",
      "--profile",
      "minimal",
      "--root",
      root,
      "--format",
      "json"
    ]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(2);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: false,
      root,
      target: "unknown-target",
      profile: "minimal",
      errors: [
        {
          code: "unsupported-target",
          message: "Export target 'unknown-target' is not supported."
        }
      ],
      warnings: []
    });
  });

  it("dry-runs a claude install as JSON without writing files", async () => {
    const root = await makeTempRoot();
    const cwd = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness(cwd);

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "install",
      "claude",
      "--profile",
      "minimal",
      "--scope",
      "project",
      "--root",
      root,
      "--format",
      "json"
    ]);

    const output = JSON.parse(harness.stdout);
    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(output).toEqual({
      ok: true,
      root,
      target: "claude",
      profile: "minimal",
      scope: "project",
      baseDir: join(cwd, ".claude", "skills"),
      dryRun: true,
      files: [
        {
          path: join(cwd, ".claude", "skills", "skills", "handoff", "SKILL.md"),
          relPath: "skills/handoff/SKILL.md",
          action: "create",
          marker: true,
          existingIsForeign: false,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      ],
      warnings: []
    });
    await expect(stat(join(cwd, ".claude"))).rejects.toThrow();
  });

  it("classifies pre-existing managed install files", async () => {
    const root = await makeTempRoot();
    const cwd = await makeTempRoot();
    await writeValidCustomLibrary(root);
    await mkdir(join(cwd, ".claude", "skills", "skills", "handoff"), { recursive: true });
    await writeFile(
      join(cwd, ".claude", "skills", "skills", "handoff", "SKILL.md"),
      "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nOld\n"
    );
    const harness = makeHarness(cwd);

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "install",
      "claude",
      "--profile",
      "minimal",
      "--scope",
      "project",
      "--root",
      root,
      "--format",
      "json"
    ]);

    expect(harness.exitCode).toBe(0);
    expect(JSON.parse(harness.stdout).files[0]).toMatchObject({
      relPath: "skills/handoff/SKILL.md",
      action: "overwrite",
      existingIsForeign: false
    });
  });

  it("prints text install plans as action and path rows", async () => {
    const root = await makeTempRoot();
    const cwd = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness(cwd);

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "install",
      "claude",
      "--profile",
      "minimal",
      "--scope",
      "project",
      "--root",
      root
    ]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(harness.stdout).toBe(
      `create\t${join(cwd, ".claude", "skills", "skills", "handoff", "SKILL.md")}\n`
    );
  });


  it("classifies pre-existing foreign install files, exits 1, and leaves them untouched", async () => {
    const root = await makeTempRoot();
    const cwd = await makeTempRoot();
    const outputPath = join(cwd, ".claude", "skills", "skills", "handoff", "SKILL.md");
    await writeValidCustomLibrary(root);
    await mkdir(join(cwd, ".claude", "skills", "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, "Human file\n");
    const harness = makeHarness(cwd);

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "install",
      "claude",
      "--profile",
      "minimal",
      "--scope",
      "project",
      "--root",
      root,
      "--format",
      "json"
    ]);

    expect(harness.exitCode).toBe(1);
    expect(JSON.parse(harness.stdout).files[0]).toMatchObject({
      action: "skip-foreign",
      existingIsForeign: true
    });
    expect(await readFile(outputPath, "utf8")).toBe("Human file\n");
  });

  it("reports markdown installs as unsupported", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "install",
      "markdown",
      "--profile",
      "minimal",
      "--root",
      root,
      "--format",
      "json"
    ]);

    expect(harness.exitCode).toBe(2);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: false,
      target: "markdown",
      errors: [{ code: "unsupported-install-path" }]
    });
  });

  it("reports unsupported install scopes", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "install",
      "codex",
      "--profile",
      "minimal",
      "--scope",
      "user",
      "--root",
      root,
      "--format",
      "json"
    ]);

    expect(harness.exitCode).toBe(2);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: false,
      target: "codex",
      errors: [{ code: "unsupported-install-scope" }]
    });
  });

  it("rejects install apply in the dry-run slice", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "install",
      "claude",
      "--profile",
      "minimal",
      "--apply",
      "--root",
      root,
      "--format",
      "json"
    ]);

    expect(harness.exitCode).toBe(2);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "unsupported-install-apply" }]
    });
  });

  it("rejects install force in the dry-run slice", async () => {
    const root = await makeTempRoot();
    await writeValidCustomLibrary(root);
    const harness = makeHarness();

    await harness.program.parseAsync([
      "node",
      "threadkit",
      "install",
      "claude",
      "--profile",
      "minimal",
      "--force",
      "--root",
      root,
      "--format",
      "json"
    ]);

    expect(harness.exitCode).toBe(2);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "unsupported-install-force" }]
    });
  });
});

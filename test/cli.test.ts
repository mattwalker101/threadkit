import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

function makeHarness() {
  let stdout = "";
  let stderr = "";
  let exitCode: number | undefined;

  const program = createProgram({
    cwd: process.cwd(),
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
    expect(JSON.parse(harness.stdout)).toEqual({
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
      "codex",
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
      target: "codex",
      profile: "minimal",
      errors: [
        {
          code: "unsupported-target",
          message: "Export target 'codex' is not supported."
        }
      ],
      warnings: []
    });
  });
});

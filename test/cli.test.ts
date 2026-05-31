import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
});

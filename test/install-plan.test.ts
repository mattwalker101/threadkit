import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlan, resolveInstallBaseDir, type InstallScope } from "../src/core/index.js";
import type { RenderResult } from "../src/core/index.js";

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "threadkit-install-plan-"));
}

function render(files: RenderResult["files"], warnings: string[] = []): RenderResult {
  return {
    format: "skill",
    files,
    warnings
  };
}

function file(content: string, relPath = "claude/skills/handoff/SKILL.md") {
  return {
    relPath,
    content,
    marker: true
  };
}

describe("install planning", () => {
  it("classifies a missing file as create", async () => {
    const baseDir = await makeTempRoot();

    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: render([file("new content")]),
      managedOnly: true
    });

    expect(plan.files).toMatchObject([
      {
        path: join(baseDir, "skills", "handoff", "SKILL.md"),
        relPath: "skills/handoff/SKILL.md",
        action: "create",
        marker: true,
        existingIsForeign: false
      }
    ]);
  });

  it("classifies an existing identical managed file as unchanged", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, content);

    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: render([file(content)]),
      managedOnly: true
    });

    expect(plan.files[0]).toMatchObject({
      action: "unchanged",
      existingIsForeign: false,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });

  it("classifies an existing different managed file as overwrite", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nOld\n");

    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: render([file("<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nNew\n")]),
      managedOnly: true
    });

    expect(plan.files[0]).toMatchObject({
      action: "overwrite",
      existingIsForeign: false
    });
  });

  it("classifies an existing unmarked file as skip-foreign", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, "Human-written file\n");

    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: render([file("generated\n")]),
      managedOnly: true
    });

    expect(plan.files[0]).toMatchObject({
      action: "skip-foreign",
      existingIsForeign: true
    });
  });

  it("treats a marker within the first 15 lines as managed", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const existing = `${Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join("\n")}\n<!-- threadkit:generated target=claude -->\nOld\n`;
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, existing);

    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: render([file("<!-- threadkit:generated target=claude -->\nNew\n")]),
      managedOnly: true
    });

    expect(plan.files[0]?.action).toBe("overwrite");
  });

  it("treats a marker after line 15 as foreign", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const existing = `${Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join("\n")}\n<!-- threadkit:generated target=claude -->\n`;
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, existing);

    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: render([file("<!-- threadkit:generated target=claude -->\nNew\n")]),
      managedOnly: true
    });

    expect(plan.files[0]?.action).toBe("skip-foreign");
  });

  it("uses stable hashes and preserves render file ordering", async () => {
    const baseDir = await makeTempRoot();
    const first = file("first", "claude/skills/first/SKILL.md");
    const second = file("second", "claude/skills/second/SKILL.md");

    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: render([first, second]),
      managedOnly: true
    });

    expect(plan.files.map((planned) => planned.relPath)).toEqual([
      "skills/first/SKILL.md",
      "skills/second/SKILL.md"
    ]);
    expect(plan.files.map((planned) => planned.sha256)).toEqual([
      "a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e",
      "16367aacb67a4a017c8da8ab95682ccb390863780f7114dda0a0e0c55644c7c4"
    ]);
  });
});

describe("install destination resolution", () => {
  it("defaults to the user path and expands home directories", () => {
    const baseDir = resolveInstallBaseDir({ targetName: "claude", scope: undefined, cwd: "/repo", env: {}, homedir: "/home/test" });

    expect(baseDir).toEqual({
      target: "claude",
      scope: "user" satisfies InstallScope,
      baseDir: "/home/test/.claude/skills"
    });
  });

  it("resolves project paths against cwd", () => {
    const baseDir = resolveInstallBaseDir({ targetName: "opencode", scope: "project", cwd: "/repo", env: {}, homedir: "/home/test" });

    expect(baseDir).toEqual({
      target: "opencode",
      scope: "project",
      baseDir: "/repo/.opencode/command"
    });
  });

  it("uses target-specific environment overrides for either scope", () => {
    const baseDir = resolveInstallBaseDir({
      targetName: "opencode",
      scope: "project",
      cwd: "/repo",
      env: { THREADKIT_OPENCODE_DIR: "~/custom-opencode" },
      homedir: "/home/test"
    });

    expect(baseDir.baseDir).toBe("/home/test/custom-opencode");
  });

  it("returns a usage-level failure for missing scoped paths", () => {
    expect(() =>
      resolveInstallBaseDir({ targetName: "codex", scope: "user", cwd: "/repo", env: {}, homedir: "/home/test" })
    ).toThrow("Install target 'codex' does not support scope 'user'.");
  });
});

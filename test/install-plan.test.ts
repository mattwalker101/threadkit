import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyInstallPlan,
  buildPlan,
  InstallPlanUsageError,
  loadInstallManifest,
  resolveInstallBaseDir,
  type InstallScope
} from "../src/core/index.js";
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

  it("classifies an existing unmarked file as overwrite-foreign when force is enabled", async () => {
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
      managedOnly: true,
      forceForeign: true
    });

    expect(plan.files[0]).toMatchObject({
      action: "overwrite-foreign",
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

describe("install application", () => {
  it("creates missing files and writes an install manifest", async () => {
    const baseDir = await makeTempRoot();
    const generated = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    const renderResult = render([file(generated)]);
    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: renderResult,
      managedOnly: true
    });

    const result = await applyInstallPlan({ plan, render: renderResult, timestamp: "2026-06-01T10-00-00-000Z" });

    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    expect(await readFile(outputPath, "utf8")).toBe(generated);
    expect(result.manifestPath).toBe(join(baseDir, ".threadkit", "install-manifest.json"));
    expect(result.files[0]).toMatchObject({
      relPath: "skills/handoff/SKILL.md",
      action: "create"
    });
    expect(result.files[0]).not.toHaveProperty("backupPath");
    expect(JSON.parse(await readFile(result.manifestPath, "utf8"))).toMatchObject({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      installedAt: "2026-06-01T10-00-00-000Z",
      files: [
        {
          relPath: "skills/handoff/SKILL.md",
          action: "create",
          marker: true,
          existingIsForeign: false,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      ]
    });
  });

  it("overwrites managed files and backs up the original", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const oldContent = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nOld\n";
    const newContent = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nNew\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, oldContent);
    const renderResult = render([file(newContent)]);
    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: renderResult,
      managedOnly: true
    });

    const result = await applyInstallPlan({ plan, render: renderResult, timestamp: "2026-06-01T10-00-00-000Z" });

    const backupPath = join(baseDir, ".threadkit", "backups", "2026-06-01T10-00-00-000Z", "skills", "handoff", "SKILL.md");
    expect(await readFile(outputPath, "utf8")).toBe(newContent);
    expect(await readFile(backupPath, "utf8")).toBe(oldContent);
    expect(result.files[0]).toMatchObject({ action: "overwrite", backupPath });
  });

  it("leaves unchanged files untouched", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nSame\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, content);
    const before = await stat(outputPath);
    const renderResult = render([file(content)]);
    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: renderResult,
      managedOnly: true
    });

    const result = await applyInstallPlan({ plan, render: renderResult, timestamp: "2026-06-01T10-00-00-000Z" });

    const after = await stat(outputPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(result.files[0]).toMatchObject({ action: "unchanged" });
    expect(result.files[0]).not.toHaveProperty("backupPath");
  });

  it("refuses plans containing skip-foreign files before writing anything", async () => {
    const baseDir = await makeTempRoot();
    const foreignPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const createPath = join(baseDir, "skills", "new", "SKILL.md");
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(foreignPath, "Human file\n");
    const renderResult = render([
      file("generated\n"),
      file("new\n", "claude/skills/new/SKILL.md")
    ]);
    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: renderResult,
      managedOnly: true
    });

    await expect(
      applyInstallPlan({ plan, render: renderResult, timestamp: "2026-06-01T10-00-00-000Z" })
    ).rejects.toThrow("Install plan contains foreign files.");

    expect(await readFile(foreignPath, "utf8")).toBe("Human file\n");
    await expect(stat(createPath)).rejects.toThrow();
  });

  it("backs up forced foreign overwrites before writing generated content", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const generated = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, "Human file\n");
    const renderResult = render([file(generated)]);
    const plan = await buildPlan({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      render: renderResult,
      managedOnly: true,
      forceForeign: true
    });

    const result = await applyInstallPlan({ plan, render: renderResult, timestamp: "2026-06-01T10-00-00-000Z" });

    const backupPath = join(baseDir, ".threadkit", "backups", "2026-06-01T10-00-00-000Z", "skills", "handoff", "SKILL.md");
    expect(await readFile(outputPath, "utf8")).toBe(generated);
    expect(await readFile(backupPath, "utf8")).toBe("Human file\n");
    expect(result.files[0]).toMatchObject({
      action: "overwrite-foreign",
      existingIsForeign: true,
      backupPath
    });
  });
});

describe("install manifest loading", () => {
  it("loads a valid install manifest", async () => {
    const baseDir = await makeTempRoot();
    const manifest = {
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      installedAt: "2026-06-01T10-00-00-000Z",
      files: [
        {
          path: join(baseDir, "skills", "handoff", "SKILL.md"),
          relPath: "skills/handoff/SKILL.md",
          action: "create",
          sha256: "a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e",
          marker: true,
          existingIsForeign: false
        }
      ]
    };
    await mkdir(join(baseDir, ".threadkit"), { recursive: true });
    await writeFile(join(baseDir, ".threadkit", "install-manifest.json"), JSON.stringify(manifest));

    await expect(loadInstallManifest({ baseDir })).resolves.toEqual(manifest);
  });

  it("throws a usage error when the install manifest is missing", async () => {
    const baseDir = await makeTempRoot();

    await expect(loadInstallManifest({ baseDir })).rejects.toMatchObject({
      code: "missing-install-manifest"
    });
    await expect(loadInstallManifest({ baseDir })).rejects.toBeInstanceOf(InstallPlanUsageError);
  });

  it("throws a usage error when the install manifest shape is invalid", async () => {
    const baseDir = await makeTempRoot();
    await mkdir(join(baseDir, ".threadkit"), { recursive: true });
    await writeFile(join(baseDir, ".threadkit", "install-manifest.json"), JSON.stringify({ files: "not an array" }));

    await expect(loadInstallManifest({ baseDir })).rejects.toMatchObject({
      code: "invalid-install-manifest"
    });
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

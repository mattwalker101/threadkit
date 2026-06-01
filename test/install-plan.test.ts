import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyUninstallPlan,
  applyInstallPlan,
  buildPlan,
  buildUninstallPlan,
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

async function writeManifest(baseDir: string, manifest: unknown): Promise<string> {
  const manifestPath = join(baseDir, ".threadkit", "install-manifest.json");
  await mkdir(join(baseDir, ".threadkit"), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

async function seedInstalledManifest(
  baseDir: string,
  outputPath: string,
  content: string,
  relPath = "skills/handoff/SKILL.md"
): Promise<string> {
  await writeManifest(baseDir, {
    target: "claude",
    profile: "minimal",
    scope: "user",
    baseDir,
    installedAt: "2026-06-01T10-00-00-000Z",
    files: [
      {
        path: outputPath,
        relPath,
        action: "create",
        sha256: createHash("sha256").update(content).digest("hex"),
        marker: true,
        existingIsForeign: false
      }
    ]
  });
  return baseDir;
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

describe("uninstall planning", () => {
  it("plans managed unchanged manifest files for deletion", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, content);
    const manifest = await loadInstallManifest({
      baseDir: await seedInstalledManifest(baseDir, outputPath, content)
    });

    const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir });

    expect(plan).toMatchObject({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      manifestPath: join(baseDir, ".threadkit", "install-manifest.json"),
      warnings: []
    });
    expect(plan.files).toMatchObject([
      {
        path: outputPath,
        relPath: "skills/handoff/SKILL.md",
        action: "delete",
        marker: true,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    ]);
  });

  it("plans missing manifest files as missing", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    const manifest = await loadInstallManifest({
      baseDir: await seedInstalledManifest(baseDir, outputPath, content)
    });

    const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir });

    expect(plan.files).toMatchObject([
      {
        path: outputPath,
        relPath: "skills/handoff/SKILL.md",
        action: "missing",
        marker: true,
        sha256: createHash("sha256").update(content).digest("hex")
      }
    ]);
  });

  it("plans edited managed files as skip-drifted", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const original = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    const edited = `${original}Edited\n`;
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, edited);
    const manifest = await loadInstallManifest({
      baseDir: await seedInstalledManifest(baseDir, outputPath, original)
    });

    const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir });

    expect(plan.files).toMatchObject([
      {
        path: outputPath,
        relPath: "skills/handoff/SKILL.md",
        action: "skip-drifted",
        marker: true,
        sha256: createHash("sha256").update(edited).digest("hex")
      }
    ]);
  });

  it("plans unmarked files as skip-foreign", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const original = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    const foreign = "Human-written file\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, foreign);
    const manifest = await loadInstallManifest({
      baseDir: await seedInstalledManifest(baseDir, outputPath, original)
    });

    const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir });

    expect(plan.files).toMatchObject([
      {
        path: outputPath,
        relPath: "skills/handoff/SKILL.md",
        action: "skip-foreign",
        marker: false,
        sha256: createHash("sha256").update(foreign).digest("hex")
      }
    ]);
  });

  it("rejects target, scope, and base directory mismatches", async () => {
    const baseDir = await makeTempRoot();
    const otherBaseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    const manifest = await loadInstallManifest({
      baseDir: await seedInstalledManifest(baseDir, outputPath, content)
    });

    await expect(buildUninstallPlan({ manifest, target: "opencode", scope: "user", baseDir })).rejects.toMatchObject({
      code: "install-manifest-target-mismatch"
    });
    await expect(buildUninstallPlan({ manifest, target: "claude", scope: "project", baseDir })).rejects.toMatchObject({
      code: "install-manifest-scope-mismatch"
    });
    await expect(buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir: otherBaseDir })).rejects.toMatchObject({
      code: "install-manifest-base-dir-mismatch"
    });
  });
});

describe("uninstall application", () => {
  it("deletes only files planned for deletion", async () => {
    const baseDir = await makeTempRoot();
    const deletePath = join(baseDir, "skills", "handoff", "SKILL.md");
    const driftedPath = join(baseDir, "skills", "changed", "SKILL.md");
    const foreignPath = join(baseDir, "skills", "foreign", "SKILL.md");
    const missingPath = join(baseDir, "skills", "missing", "SKILL.md");
    const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await mkdir(join(baseDir, "skills", "changed"), { recursive: true });
    await mkdir(join(baseDir, "skills", "foreign"), { recursive: true });
    await writeFile(deletePath, content);
    await writeFile(driftedPath, `${content}Edited\n`);
    await writeFile(foreignPath, "Human file\n");

    const plan = {
      target: "claude",
      profile: "minimal",
      scope: "user" satisfies InstallScope,
      baseDir,
      manifestPath: join(baseDir, ".threadkit", "install-manifest.json"),
      warnings: [],
      files: [
        { path: deletePath, relPath: "skills/handoff/SKILL.md", action: "delete", marker: true, sha256: "w" },
        { path: driftedPath, relPath: "skills/changed/SKILL.md", action: "skip-drifted", marker: true, sha256: "x" },
        { path: foreignPath, relPath: "skills/foreign/SKILL.md", action: "skip-foreign", marker: false, sha256: "y" },
        { path: missingPath, relPath: "skills/missing/SKILL.md", action: "missing", marker: true, sha256: "z" }
      ]
    };

    const result = await applyUninstallPlan({ plan });

    await expect(stat(deletePath)).rejects.toThrow();
    expect(await readFile(driftedPath, "utf8")).toContain("Edited");
    expect(await readFile(foreignPath, "utf8")).toBe("Human file\n");
    await expect(stat(missingPath)).rejects.toThrow();
    expect(result.manifestPath).toBe(join(baseDir, ".threadkit", "install-manifest.json"));
    expect(result.files).toMatchObject([
      { relPath: "skills/handoff/SKILL.md", action: "delete", deleted: true },
      { relPath: "skills/changed/SKILL.md", action: "skip-drifted", deleted: false },
      { relPath: "skills/foreign/SKILL.md", action: "skip-foreign", deleted: false },
      { relPath: "skills/missing/SKILL.md", action: "missing", deleted: false }
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

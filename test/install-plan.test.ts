import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyUninstallPlan,
  applyInstallPlan,
  buildPlan,
  buildRollbackPlan,
  buildUninstallPlan,
  applyRollbackPlan,
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

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
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

async function seedRollbackManifest(args: {
  baseDir: string;
  outputPath: string;
  currentContent: string;
  originalContent?: string;
  relPath?: string;
  installAction?: "create" | "overwrite" | "unchanged" | "skip-foreign" | "overwrite-foreign";
  backupPath?: string;
}): Promise<string> {
  const relPath = args.relPath ?? "skills/handoff/SKILL.md";
  const backupPath =
    args.backupPath ??
    (args.originalContent === undefined
      ? undefined
      : join(args.baseDir, ".threadkit", "backups", "2026-06-01T10-00-00-000Z", relPath));

  if (args.originalContent !== undefined && backupPath !== undefined) {
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, args.originalContent);
  }

  await writeManifest(args.baseDir, {
    target: "claude",
    profile: "minimal",
    scope: "user",
    baseDir: args.baseDir,
    installedAt: "2026-06-01T10-00-00-000Z",
    files: [
      {
        path: args.outputPath,
        relPath,
        action: args.installAction ?? "overwrite",
        sha256: sha256(args.currentContent),
        marker: true,
        existingIsForeign: false,
        ...(backupPath === undefined ? {} : { backupPath })
      }
    ]
  });

  return args.baseDir;
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
      schemaVersion: 1,
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
  it("loads legacy install manifests without a schema version and returns exactly that manifest", async () => {
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

  it("loads schema version 1 install manifests and returns exactly that manifest", async () => {
    const baseDir = await makeTempRoot();
    const manifest = {
      schemaVersion: 1,
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

  it("rejects unsupported install manifest schema versions", async () => {
    const baseDir = await makeTempRoot();
    const manifest = {
      schemaVersion: 2,
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

    await expect(loadInstallManifest({ baseDir })).rejects.toMatchObject({
      code: "unsupported-install-manifest-version"
    });
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
        { path: deletePath, relPath: "skills/handoff/SKILL.md", action: "delete", marker: true, sha256: sha256(content) },
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

  it("ignores a forged planned path outside the base directory", async () => {
    const baseDir = await makeTempRoot();
    const outsideDir = await makeTempRoot();
    const outsidePath = join(outsideDir, "outside.md");
    const insidePath = join(baseDir, "skills", "handoff", "SKILL.md");
    const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outsidePath, content);
    await writeFile(insidePath, content);

    const plan = {
      target: "claude",
      profile: "minimal",
      scope: "user" satisfies InstallScope,
      baseDir,
      manifestPath: join(baseDir, ".threadkit", "install-manifest.json"),
      warnings: [],
      files: [
        {
          path: outsidePath,
          relPath: "skills/handoff/SKILL.md",
          action: "delete" as const,
          marker: true,
          sha256: sha256(content)
        }
      ]
    };

    const result = await applyUninstallPlan({ plan });

    expect(await readFile(outsidePath, "utf8")).toBe(content);
    await expect(stat(insidePath)).rejects.toThrow();
    expect(result.files).toMatchObject([
      {
        path: insidePath,
        relPath: "skills/handoff/SKILL.md",
        action: "delete",
        deleted: true
      }
    ]);
  });

  it("does not delete a managed file replaced by foreign content after planning", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const original = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    const foreign = "Human file\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, original);
    const manifest = await loadInstallManifest({
      baseDir: await seedInstalledManifest(baseDir, outputPath, original)
    });
    const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir });
    await writeFile(outputPath, foreign);

    const result = await applyUninstallPlan({ plan });

    expect(await readFile(outputPath, "utf8")).toBe(foreign);
    expect(result.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "skip-foreign",
        marker: false,
        sha256: sha256(foreign),
        deleted: false
      }
    ]);
  });

  it("does not delete a managed file whose hash changed after planning", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const original = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
    const edited = `${original}Edited\n`;
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, original);
    const manifest = await loadInstallManifest({
      baseDir: await seedInstalledManifest(baseDir, outputPath, original)
    });
    const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir });
    await writeFile(outputPath, edited);

    const result = await applyUninstallPlan({ plan });

    expect(await readFile(outputPath, "utf8")).toBe(edited);
    expect(result.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "skip-drifted",
        marker: true,
        sha256: sha256(edited),
        deleted: false
      }
    ]);
  });
});

describe("rollback planning", () => {
  it("plans backed-up unchanged managed overwrites as restore", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const original = "Human file\n";
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, current);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });

    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir });

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
        action: "restore",
        marker: true,
        sha256: sha256(current),
        backupPath: join(baseDir, ".threadkit", "backups", "2026-06-01T10-00-00-000Z", "skills", "handoff", "SKILL.md")
      }
    ]);
  });

  it("plans created and unchanged files with no backup as no-backup", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, current);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({
        baseDir,
        outputPath,
        currentContent: current,
        installAction: "create"
      })
    });

    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir });

    expect(plan.files).toMatchObject([{ action: "no-backup", relPath: "skills/handoff/SKILL.md" }]);
  });

  it("plans drifted, foreign, and missing target files safely", async () => {
    const baseDir = await makeTempRoot();
    const driftedPath = join(baseDir, "skills", "drifted", "SKILL.md");
    const foreignPath = join(baseDir, "skills", "foreign", "SKILL.md");
    const missingPath = join(baseDir, "skills", "missing", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const drifted = `${current}Edited\n`;
    await mkdir(join(baseDir, "skills", "drifted"), { recursive: true });
    await mkdir(join(baseDir, "skills", "foreign"), { recursive: true });
    await writeFile(driftedPath, drifted);
    await writeFile(foreignPath, "Human file\n");
    const backupPath = join(baseDir, ".threadkit", "backups", "2026-06-01T10-00-00-000Z", "skills", "handoff", "SKILL.md");
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, "Original\n");
    await writeManifest(baseDir, {
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      installedAt: "2026-06-01T10-00-00-000Z",
      files: [
        {
          path: driftedPath,
          relPath: "skills/drifted/SKILL.md",
          action: "overwrite",
          sha256: sha256(current),
          marker: true,
          existingIsForeign: false,
          backupPath
        },
        {
          path: foreignPath,
          relPath: "skills/foreign/SKILL.md",
          action: "overwrite",
          sha256: sha256(current),
          marker: true,
          existingIsForeign: false,
          backupPath
        },
        {
          path: missingPath,
          relPath: "skills/missing/SKILL.md",
          action: "overwrite",
          sha256: sha256(current),
          marker: true,
          existingIsForeign: false,
          backupPath
        }
      ]
    });
    const manifest = await loadInstallManifest({ baseDir });

    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir });

    expect(plan.files).toMatchObject([
      { relPath: "skills/drifted/SKILL.md", action: "skip-drifted", marker: true, sha256: sha256(drifted) },
      { relPath: "skills/foreign/SKILL.md", action: "skip-foreign", marker: false, sha256: sha256("Human file\n") },
      { relPath: "skills/missing/SKILL.md", action: "missing", marker: true, sha256: sha256(current) }
    ]);
  });

  it("plans drifted managed files as force-restore when force is enabled", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const drifted = `${current}Edited\n`;
    const original = "Original\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, drifted);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });

    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });

    expect(plan.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "force-restore",
        marker: true,
        sha256: sha256(drifted)
      }
    ]);
  });

  it("plans foreign files as skip-foreign when force is enabled", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const foreign = "Human file\n";
    const original = "Original\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, foreign);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });

    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });

    expect(plan.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "skip-foreign",
        marker: false,
        sha256: sha256(foreign)
      }
    ]);
  });

  it("plans absent and unsafe backup paths without restoring", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, current);

    await writeManifest(baseDir, {
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      installedAt: "2026-06-01T10-00-00-000Z",
      files: [
        {
          path: outputPath,
          relPath: "skills/missing-backup/SKILL.md",
          action: "overwrite",
          sha256: sha256(current),
          marker: true,
          existingIsForeign: false,
          backupPath: join(baseDir, ".threadkit", "backups", "2026-06-01T10-00-00-000Z", "missing.md")
        },
        {
          path: outputPath,
          relPath: "skills/unsafe/SKILL.md",
          action: "overwrite",
          sha256: sha256(current),
          marker: true,
          existingIsForeign: false,
          backupPath: join(baseDir, ".threadkit", "not-backups", "old.md")
        }
      ]
    });
    const manifest = await loadInstallManifest({ baseDir });

    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir });

    expect(plan.files).toMatchObject([
      { relPath: "skills/missing-backup/SKILL.md", action: "missing-backup" },
      { relPath: "skills/unsafe/SKILL.md", action: "unsafe-backup-path" }
    ]);
  });
});

describe("rollback application", () => {
  it("restores backup content only for unchanged managed files", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const original = "Human file\n";
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, current);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });
    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir });

    const result = await applyRollbackPlan({ plan });

    expect(await readFile(outputPath, "utf8")).toBe(original);
    expect(result.manifestPath).toBe(join(baseDir, ".threadkit", "install-manifest.json"));
    expect(result.files).toMatchObject([
      { relPath: "skills/handoff/SKILL.md", action: "restore", restored: true }
    ]);
  });

  it("force restores drifted managed files after apply-time recheck", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const plannedDrift = `${current}Edited before plan\n`;
    const applyTimeDrift = `${current}Edited after plan\n`;
    const original = "Original\n";
    const applyTimeBackup = "Original re-read at apply\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, plannedDrift);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });
    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });
    await writeFile(outputPath, applyTimeDrift);
    await writeFile(plan.files[0]!.backupPath!, applyTimeBackup);

    const result = await applyRollbackPlan({ plan, force: true });

    expect(await readFile(outputPath, "utf8")).toBe(applyTimeBackup);
    expect(result.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "force-restore",
        marker: true,
        sha256: sha256(applyTimeDrift),
        restored: true
      }
    ]);
  });

  it("does not apply a planned force restore without force when drift is unchanged since planning", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const plannedDrift = `${current}Edited before plan\n`;
    const original = "Original\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, plannedDrift);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });
    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });

    const result = await applyRollbackPlan({ plan });

    expect(await readFile(outputPath, "utf8")).toBe(plannedDrift);
    expect(result.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "skip-drifted",
        marker: true,
        sha256: sha256(plannedDrift),
        restored: false
      }
    ]);
  });

  it("applies a planned force restore with force when drift is unchanged since planning", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const plannedDrift = `${current}Edited before plan\n`;
    const original = "Original\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, plannedDrift);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });
    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });

    const result = await applyRollbackPlan({ plan, force: true });

    expect(await readFile(outputPath, "utf8")).toBe(original);
    expect(result.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "force-restore",
        marker: true,
        sha256: sha256(plannedDrift),
        restored: true
      }
    ]);
  });

  it("does not force restore a malformed force plan missing installed sha", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const plannedDrift = `${current}Edited before plan\n`;
    const original = "Original\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, plannedDrift);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });
    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });
    delete plan.files[0]!.installedSha256;

    const result = await applyRollbackPlan({ plan, force: true });

    expect(await readFile(outputPath, "utf8")).toBe(plannedDrift);
    expect(result.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "skip-current",
        restored: false
      }
    ]);
  });

  it("does not apply a planned force restore without force when the file returns to installed content", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const plannedDrift = `${current}Edited before plan\n`;
    const original = "Original\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, plannedDrift);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });
    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });
    await writeFile(outputPath, current);

    const result = await applyRollbackPlan({ plan });

    expect(await readFile(outputPath, "utf8")).toBe(current);
    expect(result.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "skip-current",
        marker: true,
        sha256: sha256(current),
        restored: false
      }
    ]);
  });

  it("does not apply a planned force restore with force when the file returns to installed content", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const plannedDrift = `${current}Edited before plan\n`;
    const original = "Original\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, plannedDrift);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });
    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });
    await writeFile(outputPath, current);

    const result = await applyRollbackPlan({ plan, force: true });

    expect(await readFile(outputPath, "utf8")).toBe(current);
    expect(result.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "skip-current",
        marker: true,
        sha256: sha256(current),
        restored: false
      }
    ]);
  });

  it("does not force restore a file that became foreign after planning", async () => {
    const baseDir = await makeTempRoot();
    const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const plannedDrift = `${current}Edited before plan\n`;
    const foreign = "Human file\n";
    const original = "Original\n";
    await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
    await writeFile(outputPath, plannedDrift);
    const manifest = await loadInstallManifest({
      baseDir: await seedRollbackManifest({ baseDir, outputPath, currentContent: current, originalContent: original })
    });
    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });
    await writeFile(outputPath, foreign);

    const result = await applyRollbackPlan({ plan, force: true });

    expect(await readFile(outputPath, "utf8")).toBe(foreign);
    expect(result.files).toMatchObject([
      {
        relPath: "skills/handoff/SKILL.md",
        action: "skip-foreign",
        marker: false,
        sha256: sha256(foreign),
        restored: false
      }
    ]);
  });

  it("rechecks drift and foreign state after planning", async () => {
    const baseDir = await makeTempRoot();
    const driftedPath = join(baseDir, "skills", "drifted", "SKILL.md");
    const foreignPath = join(baseDir, "skills", "foreign", "SKILL.md");
    const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
    const original = "Original\n";
    await mkdir(join(baseDir, "skills", "drifted"), { recursive: true });
    await mkdir(join(baseDir, "skills", "foreign"), { recursive: true });
    await writeFile(driftedPath, current);
    await writeFile(foreignPath, current);
    const backupPath = join(baseDir, ".threadkit", "backups", "2026-06-01T10-00-00-000Z", "skills", "handoff", "SKILL.md");
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, original);
    await writeManifest(baseDir, {
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      installedAt: "2026-06-01T10-00-00-000Z",
      files: [
        {
          path: driftedPath,
          relPath: "skills/drifted/SKILL.md",
          action: "overwrite",
          sha256: sha256(current),
          marker: true,
          existingIsForeign: false,
          backupPath
        },
        {
          path: foreignPath,
          relPath: "skills/foreign/SKILL.md",
          action: "overwrite",
          sha256: sha256(current),
          marker: true,
          existingIsForeign: false,
          backupPath
        }
      ]
    });
    const manifest = await loadInstallManifest({ baseDir });
    const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir });
    await writeFile(driftedPath, `${current}Edited\n`);
    await writeFile(foreignPath, "Human file\n");

    const result = await applyRollbackPlan({ plan });

    expect(await readFile(driftedPath, "utf8")).toContain("Edited");
    expect(await readFile(foreignPath, "utf8")).toBe("Human file\n");
    expect(result.files).toMatchObject([
      { relPath: "skills/drifted/SKILL.md", action: "skip-drifted", restored: false },
      { relPath: "skills/foreign/SKILL.md", action: "skip-foreign", restored: false }
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

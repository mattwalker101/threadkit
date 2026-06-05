import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadBackupIndex,
  planOrApplyBackupPruneOperation,
  planOrApplyInstallOperation,
  writeBackupIndex
} from "../src/core/index.js";

const validSkillYml = `id: handoff
name: Handoff
version: 0.1.0
status: draft
summary: Creates a handoff document.
category: coordination
triggers:
  - create a handoff
  - write a handoff
profiles:
  - minimal
targets:
  claude:
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

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "threadkit-lifecycle-operations-"));
}

async function writeValidLibrary(root: string): Promise<void> {
  await mkdir(join(root, "skills", "handoff"), { recursive: true });
  await mkdir(join(root, "profiles"), { recursive: true });
  await writeFile(join(root, "skills", "handoff", "skill.yml"), validSkillYml);
  await writeFile(join(root, "skills", "handoff", "body.md"), "# Handoff\n");
  await writeFile(join(root, "profiles", "minimal.yml"), validProfileYml);
}

describe("lifecycle operations", () => {
  it("plans an install dry run without applying files", async () => {
    const root = await makeTempRoot();
    const cwd = await makeTempRoot();
    await writeValidLibrary(root);

    const result = await planOrApplyInstallOperation({
      targetName: "claude",
      profileName: "minimal",
      root,
      cwd,
      scope: "project",
      apply: false,
      force: false
    });

    expect(result).toMatchObject({
      kind: "dry-run",
      target: "claude",
      profile: "minimal",
      hasForeignFiles: false,
      plan: {
        target: "claude",
        profile: "minimal",
        scope: "project",
        files: [{ action: "create", relPath: "skills/handoff/SKILL.md" }]
      }
    });
    await expect(stat(join(cwd, ".claude", "skills", "skills", "handoff", "SKILL.md"))).rejects.toThrow();
  });

  it("applies an install operation", async () => {
    const root = await makeTempRoot();
    const cwd = await makeTempRoot();
    const outputPath = join(cwd, ".claude", "skills", "skills", "handoff", "SKILL.md");
    await writeValidLibrary(root);

    const result = await planOrApplyInstallOperation({
      targetName: "claude",
      profileName: "minimal",
      root,
      cwd,
      scope: "project",
      apply: true,
      force: false
    });

    expect(result).toMatchObject({
      kind: "applied",
      target: "claude",
      profile: "minimal",
      applied: {
        manifestPath: join(cwd, ".claude", "skills", ".threadkit", "install-manifest.json"),
        files: [{ action: "create", relPath: "skills/handoff/SKILL.md" }]
      }
    });
    expect(await readFile(outputPath, "utf8")).toContain(
      "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->"
    );
  });

  it("plans backup pruning without applying deletion", async () => {
    const cwd = await makeTempRoot();
    const baseDir = join(cwd, ".claude", "skills");
    const oldBackupDir = join(baseDir, ".threadkit", "backups", "old");
    const newBackupDir = join(baseDir, ".threadkit", "backups", "new");
    await mkdir(oldBackupDir, { recursive: true });
    await mkdir(newBackupDir, { recursive: true });
    await writeFile(join(oldBackupDir, "old.md"), "old\n");
    await writeBackupIndex({
      baseDir,
      index: {
        schemaVersion: 1,
        generations: [
          {
            id: "new",
            target: "claude",
            profile: "minimal",
            scope: "project",
            baseDir,
            installedAt: "2026-06-01T11-00-00-000Z",
            backupDir: newBackupDir,
            files: []
          },
          {
            id: "old",
            target: "claude",
            profile: "minimal",
            scope: "project",
            baseDir,
            installedAt: "2026-06-01T10-00-00-000Z",
            backupDir: oldBackupDir,
            files: []
          }
        ]
      }
    });

    const result = await planOrApplyBackupPruneOperation({
      targetName: "claude",
      cwd,
      scope: "project",
      keep: 1,
      includeOrphans: false,
      apply: false
    });

    expect(result).toMatchObject({
      kind: "dry-run",
      plan: {
        keep: 1,
        generations: [{ id: "old", action: "delete" }],
        retained: [{ id: "new" }]
      }
    });
    expect(await readFile(join(oldBackupDir, "old.md"), "utf8")).toBe("old\n");
  });

  it("applies backup pruning", async () => {
    const cwd = await makeTempRoot();
    const baseDir = join(cwd, ".claude", "skills");
    const oldBackupDir = join(baseDir, ".threadkit", "backups", "old");
    const newBackupDir = join(baseDir, ".threadkit", "backups", "new");
    await mkdir(oldBackupDir, { recursive: true });
    await mkdir(newBackupDir, { recursive: true });
    await writeFile(join(oldBackupDir, "old.md"), "old\n");
    await writeBackupIndex({
      baseDir,
      index: {
        schemaVersion: 1,
        generations: [
          {
            id: "new",
            target: "claude",
            profile: "minimal",
            scope: "project",
            baseDir,
            installedAt: "2026-06-01T11-00-00-000Z",
            backupDir: newBackupDir,
            files: []
          },
          {
            id: "old",
            target: "claude",
            profile: "minimal",
            scope: "project",
            baseDir,
            installedAt: "2026-06-01T10-00-00-000Z",
            backupDir: oldBackupDir,
            files: []
          }
        ]
      }
    });

    const result = await planOrApplyBackupPruneOperation({
      targetName: "claude",
      cwd,
      scope: "project",
      keep: 1,
      includeOrphans: false,
      apply: true
    });

    expect(result).toMatchObject({
      kind: "applied",
      applied: {
        generations: [{ id: "old", deleted: true }],
        retained: [{ id: "new" }]
      }
    });
    await expect(stat(oldBackupDir)).rejects.toThrow();
    expect((await loadBackupIndex({ baseDir })).generations.map((generation) => generation.id)).toEqual(["new"]);
  });
});

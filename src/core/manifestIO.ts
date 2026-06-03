import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { InstallPlanUsageError } from "./planTypes.js";
import { backupIndexPathForBaseDir, manifestPathForBaseDir, newestGenerationsFirst } from "./planHelpers.js";
import type {
  BackupGeneration,
  BackupGenerationFile,
  BackupIndex,
  InstallAction,
  InstallManifest,
  InstallManifestFile,
  InstallScope
} from "./planTypes.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInstallScope(value: unknown): value is InstallScope {
  return value === "user" || value === "project";
}

function isInstallAction(value: unknown): value is InstallAction {
  return (
    value === "create" ||
    value === "overwrite" ||
    value === "unchanged" ||
    value === "skip-foreign" ||
    value === "overwrite-foreign"
  );
}

function isInstallManifestSchemaVersion(value: unknown): value is InstallManifest["schemaVersion"] {
  return value === undefined || value === 1;
}

function isInstallManifestFile(value: unknown): value is InstallManifestFile {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.path === "string" &&
    typeof value.relPath === "string" &&
    isInstallAction(value.action) &&
    typeof value.sha256 === "string" &&
    typeof value.marker === "boolean" &&
    typeof value.existingIsForeign === "boolean" &&
    (value.backupPath === undefined || typeof value.backupPath === "string")
  );
}

function isBackupGenerationFile(value: unknown): value is BackupGenerationFile {
  return isInstallManifestFile(value) && typeof value.backupPath === "string";
}

function isBackupGeneration(value: unknown): value is BackupGeneration {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.target === "string" &&
    typeof value.profile === "string" &&
    isInstallScope(value.scope) &&
    typeof value.baseDir === "string" &&
    typeof value.installedAt === "string" &&
    typeof value.backupDir === "string" &&
    Array.isArray(value.files) &&
    value.files.every(isBackupGenerationFile)
  );
}

function isBackupIndex(value: unknown): value is BackupIndex {
  if (!isRecord(value)) {
    return false;
  }

  return value.schemaVersion === 1 && Array.isArray(value.generations) && value.generations.every(isBackupGeneration);
}

function isInstallManifest(value: unknown): value is InstallManifest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isInstallManifestSchemaVersion(value.schemaVersion) &&
    typeof value.target === "string" &&
    typeof value.profile === "string" &&
    isInstallScope(value.scope) &&
    typeof value.baseDir === "string" &&
    typeof value.installedAt === "string" &&
    Array.isArray(value.files) &&
    value.files.every(isInstallManifestFile)
  );
}

export async function loadInstallManifest(args: { baseDir: string }): Promise<InstallManifest> {
  const manifestPath = manifestPathForBaseDir(args.baseDir);
  let raw: string;

  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new InstallPlanUsageError(
        "missing-install-manifest",
        `Install manifest was not found at '${manifestPath}'.`
      );
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InstallPlanUsageError(
      "invalid-install-manifest",
      `Install manifest at '${manifestPath}' is not valid JSON.`
    );
  }

  if (isRecord(parsed) && !isInstallManifestSchemaVersion(parsed.schemaVersion)) {
    throw new InstallPlanUsageError(
      "unsupported-install-manifest-version",
      `Install manifest at '${manifestPath}' has unsupported schema version '${String(parsed.schemaVersion)}'.`
    );
  }

  if (!isInstallManifest(parsed)) {
    throw new InstallPlanUsageError(
      "invalid-install-manifest",
      `Install manifest at '${manifestPath}' has an invalid shape.`
    );
  }

  return parsed;
}

export async function loadBackupIndex(args: { baseDir: string }): Promise<BackupIndex> {
  const indexPath = backupIndexPathForBaseDir(args.baseDir);
  let raw: string;

  try {
    raw = await readFile(indexPath, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return { schemaVersion: 1, generations: [] };
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InstallPlanUsageError("invalid-backup-index", `Backup index at '${indexPath}' is not valid JSON.`);
  }

  if (isRecord(parsed) && parsed.schemaVersion !== 1) {
    throw new InstallPlanUsageError(
      "unsupported-backup-index-version",
      `Backup index at '${indexPath}' has unsupported schema version '${String(parsed.schemaVersion)}'.`
    );
  }

  if (!isBackupIndex(parsed)) {
    throw new InstallPlanUsageError("invalid-backup-index", `Backup index at '${indexPath}' has an invalid shape.`);
  }

  return {
    schemaVersion: 1,
    generations: newestGenerationsFirst(parsed.generations)
  };
}

export async function writeBackupIndex(args: { baseDir: string; index: BackupIndex }): Promise<string> {
  const indexPath = backupIndexPathForBaseDir(args.baseDir);
  const index: BackupIndex = {
    schemaVersion: 1,
    generations: newestGenerationsFirst(args.index.generations)
  };
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return indexPath;
}

export function backupGenerationToRollbackManifest(generation: BackupGeneration): InstallManifest {
  return {
    schemaVersion: 1,
    target: generation.target,
    profile: generation.profile,
    scope: generation.scope,
    baseDir: generation.baseDir,
    installedAt: generation.installedAt,
    manifestPath: backupIndexPathForBaseDir(generation.baseDir),
    files: generation.files.map((file) => ({ ...file }))
  };
}

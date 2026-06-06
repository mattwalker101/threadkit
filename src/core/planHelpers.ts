import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir as defaultHomedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getExportTarget } from "./exportTargets.js";
import { hasManagedMarker } from "./marker.js";
import { isInsideDirectory } from "./resolveSafePath.js";
import { InstallPlanUsageError } from "./planTypes.js";
import type {
  BackupGeneration,
  InstallScope,
  ResolveInstallBaseDirArgs,
  ResolvedInstallBaseDir
} from "./planTypes.js";

function assertInstallScope(scope: string): asserts scope is InstallScope {
  if (scope !== "user" && scope !== "project") {
    throw new InstallPlanUsageError("unsupported-scope", `Install scope '${scope}' is not supported.`);
  }
}

function expandHome(pathValue: string, home: string): string {
  if (pathValue === "~") {
    return home;
  }

  if (pathValue.startsWith("~/")) {
    return resolve(home, pathValue.slice(2));
  }

  return pathValue;
}

function resolveInstallPath(pathValue: string, cwd: string, home: string): string {
  const expanded = expandHome(pathValue, home);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

export function resolveInstallBaseDir(args: ResolveInstallBaseDirArgs): ResolvedInstallBaseDir {
  const target = getExportTarget(args.targetName);

  if (!target) {
    throw new InstallPlanUsageError(
      "unsupported-target",
      `Install target '${args.targetName}' is not supported.`
    );
  }

  const scope = args.scope ?? "user";
  assertInstallScope(scope);

  const envKey = `THREADKIT_${target.name.toUpperCase()}_DIR`;
  const override = args.env?.[envKey];
  const pathValue = override ?? target.paths?.[scope];

  if (!pathValue) {
    if (!target.paths) {
      throw new InstallPlanUsageError(
        "unsupported-install-path",
        `Install target '${target.name}' does not define install paths.`
      );
    }

    throw new InstallPlanUsageError(
      "unsupported-install-scope",
      `Install target '${target.name}' does not support scope '${scope}'.`
    );
  }

  const resolvedPath = resolveInstallPath(pathValue, args.cwd, args.homedir ?? defaultHomedir());
  const installKind = target.install?.kind ?? "directory";

  return {
    target: target.name,
    scope,
    baseDir: installKind === "file" ? dirname(resolvedPath) : resolvedPath,
    installKind
  };
}

export function manifestPathForBaseDir(baseDir: string): string {
  return join(baseDir, ".threadkit", "install-manifest.json");
}

export function backupIndexPathForBaseDir(baseDir: string): string {
  return join(baseDir, ".threadkit", "backup-index.json");
}

export function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function backupRootForBaseDir(baseDir: string): string {
  return join(baseDir, ".threadkit", "backups");
}

export function resolveBackupPath(baseDir: string, backupPath: string): string | undefined {
  const backupRoot = backupRootForBaseDir(baseDir);
  const resolvedBackupPath = isAbsolute(backupPath) ? resolve(backupPath) : resolve(baseDir, backupPath);

  if (!isInsideDirectory(backupRoot, resolvedBackupPath)) {
    return undefined;
  }

  return resolvedBackupPath;
}

export function stripTargetPrefix(target: string, relPath: string): string {
  const prefix = `${target}/`;
  return relPath.startsWith(prefix) ? relPath.slice(prefix.length) : relPath;
}

export function isSafeBackupDir(baseDir: string, backupDir: string): boolean {
  return isInsideDirectory(backupRootForBaseDir(baseDir), backupDir);
}

export async function readCurrentManagedFileState(args: {
  path: string;
  fallbackMarker: boolean;
  fallbackSha256: string;
}): Promise<
  | { kind: "present"; marker: boolean; sha256: string; content: Buffer }
  | { kind: "missing"; marker: boolean; sha256: string }
> {
  let content: Buffer;

  try {
    content = await readFile(args.path);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }

    return {
      kind: "missing",
      marker: args.fallbackMarker,
      sha256: args.fallbackSha256
    };
  }

  const currentSha256 = sha256(content);

  return {
    kind: "present",
    marker: hasManagedMarker(content) || (args.fallbackMarker && currentSha256 === args.fallbackSha256),
    sha256: currentSha256,
    content
  };
}

export async function currentRollbackState(args: {
  outputPath: string;
  expectedSha256: string;
  fallbackMarker: boolean;
}): Promise<{ action: "restore" | "skip-drifted" | "skip-foreign" | "missing"; marker: boolean; sha256: string }> {
  const current = await readCurrentManagedFileState({
    path: args.outputPath,
    fallbackMarker: args.fallbackMarker,
    fallbackSha256: args.expectedSha256
  });

  if (current.kind === "missing") {
    return { action: "missing", marker: current.marker, sha256: current.sha256 };
  }

  const marker = current.marker;
  const currentHash = current.sha256;

  if (!marker) {
    return { action: "skip-foreign", marker, sha256: currentHash };
  }

  if (currentHash !== args.expectedSha256) {
    return { action: "skip-drifted", marker, sha256: currentHash };
  }

  return { action: "restore", marker, sha256: currentHash };
}

export function newestGenerationsFirst(generations: BackupGeneration[]): BackupGeneration[] {
  return [...generations].sort((left, right) => right.installedAt.localeCompare(left.installedAt));
}

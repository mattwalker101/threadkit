import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir as defaultHomedir } from "node:os";
import { dirname, join, isAbsolute, resolve, sep } from "node:path";
import { getExportTarget } from "./exportTargets.js";
import type { ExportScope, FileSpec, RenderResult } from "./renderTypes.js";

export type InstallScope = ExportScope;
export type InstallAction = "create" | "overwrite" | "unchanged" | "skip-foreign" | "overwrite-foreign";

export interface PlannedFile {
  path: string;
  relPath: string;
  action: InstallAction;
  marker: boolean;
  existingIsForeign: boolean;
  sha256: string;
}

export interface WritePlan {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  files: PlannedFile[];
  warnings: string[];
}

export interface AppliedInstallFile extends PlannedFile {
  backupPath?: string;
}

export interface InstallManifestFile {
  path: string;
  relPath: string;
  action: InstallAction;
  sha256: string;
  marker: boolean;
  existingIsForeign: boolean;
  backupPath?: string;
}

export interface InstallManifest {
  schemaVersion?: 1;
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  installedAt: string;
  files: InstallManifestFile[];
}

export type UninstallAction = "delete" | "skip-drifted" | "skip-foreign" | "missing";
export type RollbackAction =
  | "restore"
  | "force-restore"
  | "skip-current"
  | "skip-drifted"
  | "skip-foreign"
  | "missing"
  | "no-backup"
  | "missing-backup"
  | "unsafe-backup-path";

export interface PlannedUninstallFile {
  path: string;
  relPath: string;
  action: UninstallAction;
  marker: boolean;
  sha256: string;
}

export interface UninstallPlan {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  manifestPath: string;
  files: PlannedUninstallFile[];
  warnings: string[];
}

export interface PlannedRollbackFile {
  path: string;
  relPath: string;
  action: RollbackAction;
  marker: boolean;
  sha256: string;
  installedSha256?: string;
  backupPath?: string;
}

export interface RollbackPlan {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  manifestPath: string;
  files: PlannedRollbackFile[];
  warnings: string[];
}

export interface ApplyInstallPlanResult {
  manifestPath: string;
  files: AppliedInstallFile[];
}

export interface AppliedUninstallFile extends PlannedUninstallFile {
  deleted: boolean;
}

export interface ApplyUninstallPlanResult {
  manifestPath: string;
  files: AppliedUninstallFile[];
}

export interface AppliedRollbackFile extends PlannedRollbackFile {
  restored: boolean;
}

export interface ApplyRollbackPlanResult {
  manifestPath: string;
  files: AppliedRollbackFile[];
}

export class InstallPlanUsageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ResolveInstallBaseDirArgs {
  targetName: string;
  scope?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  homedir?: string;
}

export interface ResolvedInstallBaseDir {
  target: string;
  scope: InstallScope;
  baseDir: string;
}

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

  return {
    target: target.name,
    scope,
    baseDir: resolveInstallPath(pathValue, args.cwd, args.homedir ?? defaultHomedir())
  };
}

function resolveInsideBaseDir(baseDir: string, relPath: string): string {
  const resolvedBaseDir = resolve(baseDir);
  const outputPath = resolve(resolvedBaseDir, relPath);
  const prefix = resolvedBaseDir.endsWith(sep) ? resolvedBaseDir : `${resolvedBaseDir}${sep}`;

  if (outputPath !== resolvedBaseDir && !outputPath.startsWith(prefix)) {
    throw new Error(`Install file path '${relPath}' escapes the base directory.`);
  }

  return outputPath;
}

function isInsideDirectory(baseDir: string, candidatePath: string): boolean {
  const resolvedBaseDir = resolve(baseDir);
  const resolvedCandidatePath = resolve(candidatePath);
  const prefix = resolvedBaseDir.endsWith(sep) ? resolvedBaseDir : `${resolvedBaseDir}${sep}`;
  return resolvedCandidatePath !== resolvedBaseDir && resolvedCandidatePath.startsWith(prefix);
}

function resolveBackupPath(baseDir: string, backupPath: string): string | undefined {
  const backupRoot = join(baseDir, ".threadkit", "backups");
  const resolvedBackupPath = isAbsolute(backupPath) ? resolve(backupPath) : resolve(baseDir, backupPath);

  if (!isInsideDirectory(backupRoot, resolvedBackupPath)) {
    return undefined;
  }

  return resolvedBackupPath;
}

async function contentForSpec(file: FileSpec): Promise<Buffer | string> {
  if (file.content !== undefined) {
    return file.content;
  }

  if (file.copySource !== undefined) {
    return readFile(file.copySource);
  }

  throw new Error(`Install file '${file.relPath}' must define content or copySource.`);
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function manifestPathForBaseDir(baseDir: string): string {
  return join(baseDir, ".threadkit", "install-manifest.json");
}

function stripTargetPrefix(target: string, relPath: string): string {
  const prefix = `${target}/`;
  return relPath.startsWith(prefix) ? relPath.slice(prefix.length) : relPath;
}

function hasManagedMarker(content: Buffer): boolean {
  const text = content.toString("utf8");
  const firstLines = text.split(/\r?\n/, 15);
  return firstLines.some((line) => /\bthreadkit:generated\b/.test(line));
}

export async function buildPlan(args: {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  render: RenderResult;
  managedOnly: true;
  forceForeign?: boolean;
}): Promise<WritePlan> {
  const files: PlannedFile[] = [];

  for (const file of args.render.files) {
    const relPath = stripTargetPrefix(args.target, file.relPath);
    const outputPath = resolveInsideBaseDir(args.baseDir, relPath);
    const content = await contentForSpec(file);
    const plannedHash = sha256(content);

    let action: InstallAction = "create";
    let existingIsForeign = false;

    try {
      const existing = await readFile(outputPath);
      if (args.managedOnly && !hasManagedMarker(existing)) {
        action = args.forceForeign === true ? "overwrite-foreign" : "skip-foreign";
        existingIsForeign = true;
      } else {
        action = sha256(existing) === plannedHash ? "unchanged" : "overwrite";
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    files.push({
      path: outputPath,
      relPath,
      action,
      marker: file.marker,
      existingIsForeign,
      sha256: plannedHash
    });
  }

  return {
    target: args.target,
    profile: args.profile,
    scope: args.scope,
    baseDir: resolve(args.baseDir),
    files,
    warnings: args.render.warnings
  };
}

function timestampForPath(timestamp: string | Date | undefined): string {
  if (timestamp instanceof Date) {
    return timestamp.toISOString().replace(/[:.]/g, "-");
  }

  if (timestamp !== undefined) {
    return timestamp;
  }

  return new Date().toISOString().replace(/[:.]/g, "-");
}

function contentByRelPath(target: string, render: RenderResult): Map<string, FileSpec> {
  const files = new Map<string, FileSpec>();

  for (const file of render.files) {
    files.set(stripTargetPrefix(target, file.relPath), file);
  }

  return files;
}

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

function assertManifestMatches(args: {
  manifest: InstallManifest;
  target: string;
  scope: InstallScope;
  baseDir: string;
}): void {
  if (args.manifest.target !== args.target) {
    throw new InstallPlanUsageError(
      "install-manifest-target-mismatch",
      "Install manifest target does not match uninstall target."
    );
  }

  if (args.manifest.scope !== args.scope) {
    throw new InstallPlanUsageError(
      "install-manifest-scope-mismatch",
      "Install manifest scope does not match uninstall scope."
    );
  }

  if (resolve(args.manifest.baseDir) !== resolve(args.baseDir)) {
    throw new InstallPlanUsageError(
      "install-manifest-base-dir-mismatch",
      "Install manifest base directory does not match uninstall destination."
    );
  }
}

export async function buildUninstallPlan(args: {
  manifest: InstallManifest;
  target: string;
  scope: InstallScope;
  baseDir: string;
}): Promise<UninstallPlan> {
  assertManifestMatches(args);

  const files: PlannedUninstallFile[] = [];

  for (const file of args.manifest.files) {
    const outputPath = resolveInsideBaseDir(args.baseDir, file.relPath);
    let action: UninstallAction = "delete";
    let marker = file.marker;
    let currentHash = file.sha256;

    try {
      const existing = await readFile(outputPath);
      marker = hasManagedMarker(existing);
      currentHash = sha256(existing);

      if (!marker) {
        action = "skip-foreign";
      } else if (currentHash !== file.sha256) {
        action = "skip-drifted";
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }

      action = "missing";
    }

    files.push({
      path: outputPath,
      relPath: file.relPath,
      action,
      marker,
      sha256: currentHash
    });
  }

  return {
    target: args.manifest.target,
    profile: args.manifest.profile,
    scope: args.manifest.scope,
    baseDir: resolve(args.baseDir),
    manifestPath: manifestPathForBaseDir(args.baseDir),
    files,
    warnings: []
  };
}

export async function applyUninstallPlan(args: { plan: UninstallPlan }): Promise<ApplyUninstallPlanResult> {
  const files: AppliedUninstallFile[] = [];

  for (const planned of args.plan.files) {
    const outputPath = resolveInsideBaseDir(args.plan.baseDir, planned.relPath);
    const applied: AppliedUninstallFile = { ...planned, path: outputPath, deleted: false };

    if (planned.action === "delete") {
      let existing: Buffer;

      try {
        existing = await readFile(outputPath);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code !== "ENOENT") {
          throw error;
        }

        applied.action = "missing";
        files.push(applied);
        continue;
      }

      const currentHash = sha256(existing);
      applied.marker = hasManagedMarker(existing);
      applied.sha256 = currentHash;

      if (!applied.marker) {
        applied.action = "skip-foreign";
      } else if (currentHash !== planned.sha256) {
        applied.action = "skip-drifted";
      } else {
        await unlink(outputPath);
        applied.deleted = true;
      }
    }

    files.push(applied);
  }

  return {
    manifestPath: args.plan.manifestPath,
    files
  };
}

async function currentRollbackState(args: {
  outputPath: string;
  expectedSha256: string;
  fallbackMarker: boolean;
}): Promise<{ action: "restore" | "skip-drifted" | "skip-foreign" | "missing"; marker: boolean; sha256: string }> {
  let existing: Buffer;

  try {
    existing = await readFile(args.outputPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }

    return {
      action: "missing",
      marker: args.fallbackMarker,
      sha256: args.expectedSha256
    };
  }

  const marker = hasManagedMarker(existing);
  const currentHash = sha256(existing);

  if (!marker) {
    return {
      action: "skip-foreign",
      marker,
      sha256: currentHash
    };
  }

  if (currentHash !== args.expectedSha256) {
    return {
      action: "skip-drifted",
      marker,
      sha256: currentHash
    };
  }

  return {
    action: "restore",
    marker,
    sha256: currentHash
  };
}

export async function buildRollbackPlan(args: {
  manifest: InstallManifest;
  target: string;
  scope: InstallScope;
  baseDir: string;
  force?: boolean;
}): Promise<RollbackPlan> {
  assertManifestMatches(args);

  const files: PlannedRollbackFile[] = [];

  for (const file of args.manifest.files) {
    const outputPath = resolveInsideBaseDir(args.baseDir, file.relPath);
    let action: RollbackAction = "restore";
    let marker = file.marker;
    let currentHash = file.sha256;
    let backupPath: string | undefined;

    if (file.backupPath === undefined) {
      action = "no-backup";
    } else {
      backupPath = resolveBackupPath(args.baseDir, file.backupPath);

      if (backupPath === undefined) {
        action = "unsafe-backup-path";
      } else {
        try {
          await readFile(backupPath);
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
          if (code !== "ENOENT") {
            throw error;
          }

          action = "missing-backup";
        }
      }
    }

    if (action === "restore") {
      const current = await currentRollbackState({
        outputPath,
        expectedSha256: file.sha256,
        fallbackMarker: file.marker
      });
      action = current.action;
      marker = current.marker;
      currentHash = current.sha256;

      if (args.force === true && action === "skip-drifted" && marker) {
        action = "force-restore";
      }
    }

    files.push({
      path: outputPath,
      relPath: file.relPath,
      action,
      marker,
      sha256: currentHash,
      ...(action === "force-restore" ? { installedSha256: file.sha256 } : {}),
      ...(backupPath === undefined ? {} : { backupPath })
    });
  }

  return {
    target: args.manifest.target,
    profile: args.manifest.profile,
    scope: args.manifest.scope,
    baseDir: resolve(args.baseDir),
    manifestPath: manifestPathForBaseDir(args.baseDir),
    files,
    warnings: []
  };
}

export async function applyRollbackPlan(args: { plan: RollbackPlan; force?: boolean }): Promise<ApplyRollbackPlanResult> {
  const files: AppliedRollbackFile[] = [];

  for (const planned of args.plan.files) {
    const outputPath = resolveInsideBaseDir(args.plan.baseDir, planned.relPath);
    const applied: AppliedRollbackFile = { ...planned, path: outputPath, restored: false };

    if (planned.action === "restore" || planned.action === "force-restore") {
      const expectedSha256 = planned.action === "force-restore" ? planned.installedSha256 : planned.sha256;
      if (expectedSha256 === undefined) {
        applied.action = "skip-current";
        files.push(applied);
        continue;
      }

      if (planned.backupPath === undefined) {
        applied.action = "no-backup";
        files.push(applied);
        continue;
      }

      const backupPath = resolveBackupPath(args.plan.baseDir, planned.backupPath);

      if (backupPath === undefined) {
        applied.action = "unsafe-backup-path";
        delete applied.backupPath;
        files.push(applied);
        continue;
      }

      applied.backupPath = backupPath;

      let backup: Buffer;
      try {
        backup = await readFile(backupPath);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code !== "ENOENT") {
          throw error;
        }

        applied.action = "missing-backup";
        files.push(applied);
        continue;
      }

      const current = await currentRollbackState({
        outputPath,
        expectedSha256,
        fallbackMarker: planned.marker
      });
      if (planned.action === "force-restore") {
        applied.action =
          args.force === true && current.action === "skip-drifted" && current.marker
            ? "force-restore"
            : current.action === "restore"
              ? "skip-current"
              : current.action;
      } else {
        applied.action = current.action;
      }
      applied.marker = current.marker;
      applied.sha256 = current.sha256;

      if (applied.action === "restore" || applied.action === "force-restore") {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, backup);
        applied.restored = true;
      }
    }

    files.push(applied);
  }

  return {
    manifestPath: args.plan.manifestPath,
    files
  };
}

export async function applyInstallPlan(args: {
  plan: WritePlan;
  render: RenderResult;
  timestamp?: string | Date;
}): Promise<ApplyInstallPlanResult> {
  if (args.plan.files.some((file) => file.action === "skip-foreign")) {
    throw new InstallPlanUsageError("blocked-foreign-files", "Install plan contains foreign files.");
  }

  const timestamp = timestampForPath(args.timestamp);
  const renderFiles = contentByRelPath(args.plan.target, args.render);
  const appliedFiles: AppliedInstallFile[] = [];

  for (const planned of args.plan.files) {
    const applied: AppliedInstallFile = { ...planned };

    if (planned.action === "create" || planned.action === "overwrite" || planned.action === "overwrite-foreign") {
      const renderFile = renderFiles.get(planned.relPath);

      if (!renderFile) {
        throw new Error(`Install file '${planned.relPath}' was not found in the render result.`);
      }

      if (planned.action === "overwrite" || planned.action === "overwrite-foreign") {
        const existing = await readFile(planned.path);
        const backupPath = join(args.plan.baseDir, ".threadkit", "backups", timestamp, planned.relPath);
        await mkdir(dirname(backupPath), { recursive: true });
        await writeFile(backupPath, existing);
        applied.backupPath = backupPath;
      }

      const content = await contentForSpec(renderFile);
      await mkdir(dirname(planned.path), { recursive: true });
      await writeFile(planned.path, content);
    }

    appliedFiles.push(applied);
  }

  const manifestPath = manifestPathForBaseDir(args.plan.baseDir);
  const manifest: InstallManifest = {
    schemaVersion: 1,
    target: args.plan.target,
    profile: args.plan.profile,
    scope: args.plan.scope,
    baseDir: args.plan.baseDir,
    installedAt: timestamp,
    files: appliedFiles.map((file) => ({
      path: file.path,
      relPath: file.relPath,
      action: file.action,
      sha256: file.sha256,
      marker: file.marker,
      existingIsForeign: file.existingIsForeign,
      ...(file.backupPath === undefined ? {} : { backupPath: file.backupPath })
    }))
  };

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    manifestPath,
    files: appliedFiles
  };
}

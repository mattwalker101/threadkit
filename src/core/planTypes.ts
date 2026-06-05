import type { ExportScope } from "./renderTypes.js";

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
  manifestPath?: string;
}

export interface BackupGenerationFile extends InstallManifestFile {
  backupPath: string;
}

export interface BackupGeneration {
  id: string;
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  installedAt: string;
  backupDir: string;
  files: BackupGenerationFile[];
}

export interface BackupIndex {
  schemaVersion: 1;
  generations: BackupGeneration[];
}

export type UninstallAction = "delete" | "skip-drifted" | "skip-foreign" | "missing";
export type UninstallDirectoryAction = "prune" | "skip-nonempty";
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

export interface PlannedUninstallDirectory {
  path: string;
  relPath: string;
  action: UninstallDirectoryAction;
}

export interface UninstallPlan {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  manifestPath: string;
  files: PlannedUninstallFile[];
  directories: PlannedUninstallDirectory[];
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

export interface AppliedUninstallDirectory extends PlannedUninstallDirectory {
  pruned: boolean;
}

export interface ApplyUninstallPlanResult {
  manifestPath: string;
  files: AppliedUninstallFile[];
  directories: AppliedUninstallDirectory[];
}

export interface AppliedRollbackFile extends PlannedRollbackFile {
  restored: boolean;
}

export interface ApplyRollbackPlanResult {
  manifestPath: string;
  files: AppliedRollbackFile[];
}

export type BackupPruneAction = "delete" | "unsafe-backup-dir";

export interface PlannedBackupPruneGeneration extends BackupGeneration {
  action: BackupPruneAction;
}

export interface PlannedBackupPruneOrphan {
  path: string;
  relPath: string;
  action: BackupPruneAction;
}

export interface BackupPrunePlan {
  index: BackupIndex;
  baseDir: string;
  target: string;
  scope: InstallScope;
  keep: number;
  dryRun: true;
  generations: PlannedBackupPruneGeneration[];
  orphans: PlannedBackupPruneOrphan[];
  retained: BackupGeneration[];
  warnings: string[];
}

export interface AppliedBackupPruneGeneration extends PlannedBackupPruneGeneration {
  deleted: boolean;
}

export interface AppliedBackupPruneOrphan extends PlannedBackupPruneOrphan {
  deleted: boolean;
}

export interface ApplyBackupPrunePlanResult {
  indexPath: string;
  generations: AppliedBackupPruneGeneration[];
  orphans: AppliedBackupPruneOrphan[];
  retained: BackupGeneration[];
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

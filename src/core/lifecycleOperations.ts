import {
  applyBackupPrunePlan,
  applyInstallPlan,
  applyRollbackPlan,
  applyUninstallPlan
} from "./applyPlans.js";
import {
  backupGenerationToRollbackManifest,
  loadBackupIndex,
  loadInstallManifest
} from "./manifestIO.js";
import {
  buildBackupPrunePlan,
  buildPlan,
  buildRollbackPlan,
  buildUninstallPlan
} from "./buildPlans.js";
import { findBackupGeneration, matchingBackupGenerations } from "./backupGenerations.js";
import { getExportTarget } from "./exportTargets.js";
import { loadLibrary } from "./loadLibrary.js";
import {
  type ApplyBackupPrunePlanResult,
  type ApplyInstallPlanResult,
  type ApplyRollbackPlanResult,
  type ApplyUninstallPlanResult,
  type BackupGeneration,
  type BackupPrunePlan,
  type InstallScope,
  InstallPlanUsageError,
  type RollbackPlan,
  type UninstallPlan,
  type WritePlan
} from "./planTypes.js";
import { resolveInstallBaseDir } from "./planHelpers.js";
import { resolveProfile } from "./resolveProfile.js";
import { getRenderer } from "./renderers.js";

export interface InstallOperationArgs {
  targetName: string;
  profileName: string | undefined;
  root: string;
  cwd: string;
  scope?: string;
  apply: boolean;
  force: boolean;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export type InstallOperationResult =
  | {
      kind: "dry-run";
      root: string;
      target: string;
      profile: string;
      plan: WritePlan;
      hasForeignFiles: boolean;
    }
  | {
      kind: "applied";
      root: string;
      target: string;
      profile: string;
      plan: WritePlan;
      applied: ApplyInstallPlanResult;
      hasForeignFiles: false;
    };

export interface UninstallOperationArgs {
  targetName: string;
  cwd: string;
  scope?: string;
  apply: boolean;
  pruneEmptyDirs: boolean;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export type UninstallOperationResult =
  | { kind: "dry-run"; plan: UninstallPlan }
  | { kind: "applied"; plan: UninstallPlan; applied: ApplyUninstallPlanResult };

export interface RollbackOperationArgs {
  targetName: string;
  cwd: string;
  scope?: string;
  apply: boolean;
  force: boolean;
  generation?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export type RollbackOperationResult =
  | { kind: "dry-run"; plan: RollbackPlan }
  | { kind: "applied"; plan: RollbackPlan; applied: ApplyRollbackPlanResult };

export interface BackupListOperationArgs {
  targetName: string;
  cwd: string;
  scope?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export interface BackupListOperationResult {
  target: string;
  scope: InstallScope;
  baseDir: string;
  generations: BackupGeneration[];
}

export interface BackupPruneOperationArgs extends BackupListOperationArgs {
  keep: number;
  includeOrphans: boolean;
  apply: boolean;
}

export type BackupPruneOperationResult =
  | { kind: "dry-run"; plan: BackupPrunePlan }
  | { kind: "applied"; plan: BackupPrunePlan; applied: ApplyBackupPrunePlanResult };

export async function planOrApplyInstallOperation(args: InstallOperationArgs): Promise<InstallOperationResult> {
  if (!args.profileName) {
    throw new InstallPlanUsageError("missing-profile", "Install requires --profile <name>.");
  }

  const resolvedInstall = resolveInstallBaseDir({
    targetName: args.targetName,
    scope: args.scope,
    cwd: args.cwd,
    env: args.env ?? process.env
  });
  const target = getExportTarget(args.targetName);

  if (!target) {
    throw new InstallPlanUsageError("unsupported-target", `Install target '${args.targetName}' is not supported.`);
  }

  const library = await loadLibrary(args.root);
  const profile = library.profiles.find((candidate) => candidate.name === args.profileName);

  if (!profile) {
    throw new InstallPlanUsageError("unknown-profile", `Profile '${args.profileName}' was not found.`);
  }

  const resolved = resolveProfile({ profile, skills: library.skills });
  const renderer = getRenderer(target.format);

  if (!renderer) {
    throw new InstallPlanUsageError("unsupported-format", `Export format '${target.format}' is not supported.`);
  }

  const render = renderer.render({
    profile: args.profileName,
    target: target.name,
    scope: resolvedInstall.scope,
    skills: resolved.skills
  });
  const plan = await buildPlan({
    target: target.name,
    profile: args.profileName,
    scope: resolvedInstall.scope,
    baseDir: resolvedInstall.baseDir,
    render,
    managedOnly: true,
    forceForeign: args.force
  });
  const hasForeignFiles = plan.files.some((file) => file.action === "skip-foreign");

  if (!args.apply || hasForeignFiles) {
    return {
      kind: "dry-run",
      root: args.root,
      target: target.name,
      profile: args.profileName,
      plan,
      hasForeignFiles
    };
  }

  return {
    kind: "applied",
    root: args.root,
    target: target.name,
    profile: args.profileName,
    plan,
    applied: await applyInstallPlan({ plan, render }),
    hasForeignFiles: false
  };
}

export async function planOrApplyUninstallOperation(args: UninstallOperationArgs): Promise<UninstallOperationResult> {
  const resolvedInstall = resolveInstallBaseDir({
    targetName: args.targetName,
    scope: args.scope,
    cwd: args.cwd,
    env: args.env ?? process.env
  });
  const manifest = await loadInstallManifest({ baseDir: resolvedInstall.baseDir });
  const plan = await buildUninstallPlan({
    manifest,
    target: resolvedInstall.target,
    scope: resolvedInstall.scope,
    baseDir: resolvedInstall.baseDir,
    pruneEmptyDirs: args.pruneEmptyDirs
  });

  if (!args.apply) {
    return { kind: "dry-run", plan };
  }

  return { kind: "applied", plan, applied: await applyUninstallPlan({ plan }) };
}

export async function planOrApplyRollbackOperation(args: RollbackOperationArgs): Promise<RollbackOperationResult> {
  const resolvedInstall = resolveInstallBaseDir({
    targetName: args.targetName,
    scope: args.scope,
    cwd: args.cwd,
    env: args.env ?? process.env
  });
  const manifest =
    args.generation === undefined
      ? await loadInstallManifest({ baseDir: resolvedInstall.baseDir })
      : backupGenerationToRollbackManifest(
          await findRollbackGeneration({
            baseDir: resolvedInstall.baseDir,
            target: resolvedInstall.target,
            scope: resolvedInstall.scope,
            generation: args.generation
          })
        );
  const plan = await buildRollbackPlan({
    manifest,
    target: resolvedInstall.target,
    scope: resolvedInstall.scope,
    baseDir: resolvedInstall.baseDir,
    force: args.force
  });

  if (!args.apply) {
    return { kind: "dry-run", plan };
  }

  return { kind: "applied", plan, applied: await applyRollbackPlan({ plan, force: args.force }) };
}

export async function listBackupGenerationsOperation(
  args: BackupListOperationArgs
): Promise<BackupListOperationResult> {
  const resolvedInstall = resolveInstallBaseDir({
    targetName: args.targetName,
    scope: args.scope,
    cwd: args.cwd,
    env: args.env ?? process.env
  });
  const index = await loadBackupIndex({ baseDir: resolvedInstall.baseDir });

  return {
    target: resolvedInstall.target,
    scope: resolvedInstall.scope,
    baseDir: resolvedInstall.baseDir,
    generations: matchingBackupGenerations(index, resolvedInstall)
  };
}

export async function planOrApplyBackupPruneOperation(
  args: BackupPruneOperationArgs
): Promise<BackupPruneOperationResult> {
  const resolvedInstall = resolveInstallBaseDir({
    targetName: args.targetName,
    scope: args.scope,
    cwd: args.cwd,
    env: args.env ?? process.env
  });
  const index = await loadBackupIndex({ baseDir: resolvedInstall.baseDir });
  const plan = buildBackupPrunePlan({
    index,
    baseDir: resolvedInstall.baseDir,
    target: resolvedInstall.target,
    scope: resolvedInstall.scope,
    keep: args.keep,
    includeOrphans: args.includeOrphans
  });

  if (!args.apply) {
    return { kind: "dry-run", plan };
  }

  return { kind: "applied", plan, applied: await applyBackupPrunePlan({ plan }) };
}

async function findRollbackGeneration(args: {
  baseDir: string;
  target: string;
  scope: InstallScope;
  generation: string;
}): Promise<BackupGeneration> {
  const index = await loadBackupIndex({ baseDir: args.baseDir });
  const generation = findBackupGeneration(
    index,
    { target: args.target, scope: args.scope, baseDir: args.baseDir },
    args.generation
  );

  if (!generation) {
    throw new InstallPlanUsageError(
      "missing-backup-generation",
      `Backup generation '${args.generation}' was not found.`
    );
  }

  return generation;
}

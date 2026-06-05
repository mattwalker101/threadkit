import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  auditLibrary,
  getExportTarget,
  getRenderer,
  InstallPlanUsageError,
  loadLibrary,
  listBackupGenerationsOperation,
  planOrApplyBackupPruneOperation,
  planOrApplyInstallOperation,
  planOrApplyRollbackOperation,
  planOrApplyUninstallOperation,
  resolveProfile,
  writeExportFiles
} from "../core/index.js";
import {
  formatAuditError,
  formatAuditSuccess,
  formatBackupListError,
  formatBackupListSuccess,
  formatBackupPruneApplied,
  formatBackupPruneDryRun,
  formatBackupPruneError,
  formatExportError,
  formatExportSuccess,
  formatInstallApplied,
  formatInstallDryRun,
  formatInstallError,
  formatListError,
  formatListSuccess,
  formatRollbackApplied,
  formatRollbackDryRun,
  formatRollbackError,
  formatShowError,
  formatShowSuccess,
  formatUninstallApplied,
  formatUninstallDryRun,
  formatUninstallError,
  formatValidateError,
  formatValidateSuccess,
  getFormat,
  type CliError,
  type CommandOutput
} from "./output.js";

export interface CommandContext {
  cwd: string;
  write: (value: string) => void;
  writeError: (value: string) => void;
  setExitCode: (code: number) => void;
}

export interface RootOptions {
  root?: string;
  format?: string;
}

export interface ExportOptions extends RootOptions {
  profile?: string;
  out?: string;
}

export interface InstallOptions extends RootOptions {
  profile?: string;
  scope?: string;
  apply?: boolean;
  force?: boolean;
}

export interface UninstallOptions {
  scope?: string;
  format?: string;
  apply?: boolean;
  pruneEmptyDirs?: boolean;
}

export interface RollbackOptions {
  scope?: string;
  format?: string;
  apply?: boolean;
  force?: boolean;
  generation?: string;
}

export interface BackupListOptions {
  scope?: string;
  format?: string;
}

export interface BackupPruneOptions {
  scope?: string;
  format?: string;
  keep?: string;
  orphans?: boolean;
  apply?: boolean;
}

export interface AuditOptions extends RootOptions {
  strict?: boolean;
}

class CliUsageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function getRoot(options: RootOptions, context: CommandContext): string {
  return resolve(context.cwd, options.root ?? ".");
}

function isDefaultRepoRoot(root: string, options: RootOptions, context: CommandContext): boolean {
  if (options.root !== undefined || root !== resolve(context.cwd)) {
    return false;
  }

  return (
    existsSync(resolve(root, "package.json")) &&
    existsSync(resolve(root, "skills")) &&
    existsSync(resolve(root, "profiles"))
  );
}

function normalizeError(error: unknown): CliError {
  if (error instanceof CliUsageError) {
    return {
      code: error.code,
      message: error.message
    };
  }

  if (error instanceof InstallPlanUsageError) {
    return {
      code: error.code,
      message: error.message
    };
  }

  return {
    code: "validation-error",
    message: error instanceof Error ? error.message : String(error)
  };
}

function isUsageError(error: unknown): boolean {
  return error instanceof CliUsageError || error instanceof InstallPlanUsageError;
}

function emit(context: CommandContext, output: CommandOutput): void {
  if (output.stream === "stderr") {
    context.writeError(output.text);
    return;
  }

  context.write(output.text);
}

// ── validate ──────────────────────────────────────────────────────────────────

export async function runValidate(options: RootOptions, context: CommandContext): Promise<void> {
  const root = getRoot(options, context);
  const format = getFormat(options.format);

  try {
    await loadLibrary(root, { canonical: isDefaultRepoRoot(root, options, context) });
    context.setExitCode(0);
    emit(context, formatValidateSuccess(format, root));
  } catch (error) {
    context.setExitCode(1);
    emit(context, formatValidateError(format, root, normalizeError(error)));
  }
}

// ── audit ─────────────────────────────────────────────────────────────────────

export async function runAudit(options: AuditOptions, context: CommandContext): Promise<void> {
  const root = getRoot(options, context);
  const format = getFormat(options.format);

  try {
    const library = await loadLibrary(root, { canonical: isDefaultRepoRoot(root, options, context) });
    const result = await auditLibrary(library);
    const exitCode = options.strict === true && result.warnings.length > 0 ? 1 : 0;
    context.setExitCode(exitCode);
    emit(context, formatAuditSuccess(format, root, result.warnings));
  } catch (error) {
    context.setExitCode(1);
    emit(context, formatAuditError(format, root, normalizeError(error)));
  }
}

// ── list ──────────────────────────────────────────────────────────────────────

export async function runList(options: RootOptions, context: CommandContext): Promise<void> {
  const root = getRoot(options, context);
  const format = getFormat(options.format);

  try {
    const library = await loadLibrary(root);
    context.setExitCode(0);
    const skills = library.skills.map((skill) => ({
      id: skill.id,
      name: skill.metadata.name,
      summary: skill.metadata.summary,
      profiles: skill.metadata.profiles,
      status: skill.metadata.status
    }));
    emit(context, formatListSuccess(format, root, skills));
  } catch (error) {
    context.setExitCode(1);
    emit(context, formatListError(format, root, normalizeError(error)));
  }
}

// ── show ──────────────────────────────────────────────────────────────────────

export async function runShow(
  skillId: string,
  options: RootOptions,
  context: CommandContext
): Promise<void> {
  const root = getRoot(options, context);
  const format = getFormat(options.format);

  try {
    const library = await loadLibrary(root);
    const skill = library.skills.find((candidate) => candidate.id === skillId);

    if (!skill) {
      throw new CliUsageError("unknown-skill", `Skill '${skillId}' was not found.`);
    }

    context.setExitCode(0);
    emit(context, formatShowSuccess(format, root, skill));
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    emit(context, formatShowError(format, root, normalizeError(error)));
  }
}

// ── export ────────────────────────────────────────────────────────────────────

export async function runExport(
  targetName: string,
  options: ExportOptions,
  context: CommandContext
): Promise<void> {
  const root = getRoot(options, context);
  const outDir = resolve(context.cwd, options.out ?? join(root, "dist"));
  const format = getFormat(options.format);
  const profileName = options.profile;

  try {
    if (!profileName) {
      throw new CliUsageError("missing-profile", "Export requires --profile <name>.");
    }

    const target = getExportTarget(targetName);

    if (!target) {
      throw new CliUsageError("unsupported-target", `Export target '${targetName}' is not supported.`);
    }

    const library = await loadLibrary(root);
    const profile = library.profiles.find((candidate) => candidate.name === profileName);

    if (!profile) {
      throw new CliUsageError("unknown-profile", `Profile '${profileName}' was not found.`);
    }

    const resolved = resolveProfile({ profile, skills: library.skills });
    const renderer = getRenderer(target.format);

    if (!renderer) {
      throw new CliUsageError("unsupported-format", `Export format '${target.format}' is not supported.`);
    }

    const result = renderer.render({
      profile: profileName,
      target: target.name,
      scope: "user",
      skills: resolved.skills
    });
    const files = await writeExportFiles({ outDir, files: result.files });

    context.setExitCode(0);
    emit(
      context,
      formatExportSuccess({
        format,
        root,
        target: target.name,
        profile: profileName,
        outDir,
        files,
        warnings: result.warnings
      })
    );
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    emit(
      context,
      formatExportError({ format, root, target: targetName, profile: profileName, error: normalizeError(error) })
    );
  }
}

// ── install ───────────────────────────────────────────────────────────────────

export async function runInstall(
  targetName: string,
  options: InstallOptions,
  context: CommandContext
): Promise<void> {
  const root = getRoot(options, context);
  const format = getFormat(options.format);
  const profileName = options.profile;

  try {
    const result = await planOrApplyInstallOperation({
      targetName,
      profileName,
      root,
      cwd: context.cwd,
      scope: options.scope,
      apply: options.apply === true,
      force: options.force === true,
      env: process.env
    });

    if (result.kind === "dry-run") {
      context.setExitCode(result.hasForeignFiles ? 1 : 0);
      emit(context, formatInstallDryRun(format, root, result.plan));
      return;
    }

    context.setExitCode(0);
    emit(context, formatInstallApplied(format, root, result.plan, result.applied));
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    emit(
      context,
      formatInstallError({ format, root, target: targetName, profile: profileName, error: normalizeError(error) })
    );
  }
}

// ── uninstall ─────────────────────────────────────────────────────────────────

export async function runUninstall(
  targetName: string,
  options: UninstallOptions,
  context: CommandContext
): Promise<void> {
  const format = getFormat(options.format);

  try {
    const result = await planOrApplyUninstallOperation({
      targetName,
      cwd: context.cwd,
      scope: options.scope,
      apply: options.apply === true,
      pruneEmptyDirs: options.pruneEmptyDirs === true,
      env: process.env
    });

    if (result.kind === "dry-run") {
      context.setExitCode(0);
      emit(context, formatUninstallDryRun(format, result.plan, options.pruneEmptyDirs === true));
      return;
    }

    context.setExitCode(0);
    emit(context, formatUninstallApplied(format, result.plan, result.applied, options.pruneEmptyDirs === true));
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    emit(context, formatUninstallError(format, targetName, normalizeError(error)));
  }
}

// ── rollback ──────────────────────────────────────────────────────────────────

export async function runRollback(
  targetName: string,
  options: RollbackOptions,
  context: CommandContext
): Promise<void> {
  const format = getFormat(options.format);

  try {
    const result = await planOrApplyRollbackOperation({
      targetName,
      cwd: context.cwd,
      scope: options.scope,
      force: options.force === true,
      apply: options.apply === true,
      generation: options.generation,
      env: process.env
    });

    if (result.kind === "dry-run") {
      context.setExitCode(0);
      emit(
        context,
        formatRollbackDryRun({
          format,
          plan: result.plan,
          force: options.force === true,
          generation: options.generation
        })
      );
      return;
    }

    const restored = result.applied.files.filter((file) => file.restored).length;

    context.setExitCode(0);
    emit(
      context,
      formatRollbackApplied({
        format,
        plan: result.plan,
        applied: result.applied,
        force: options.force === true,
        generation: options.generation,
        restored
      })
    );
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    emit(context, formatRollbackError(format, targetName, normalizeError(error)));
  }
}

// ── backup list ───────────────────────────────────────────────────────────────

export async function runBackupList(
  targetName: string,
  options: BackupListOptions,
  context: CommandContext
): Promise<void> {
  const format = getFormat(options.format);

  try {
    const result = await listBackupGenerationsOperation({
      targetName,
      cwd: context.cwd,
      scope: options.scope,
      env: process.env
    });

    context.setExitCode(0);
    emit(
      context,
      formatBackupListSuccess({
        format,
        target: result.target,
        scope: result.scope,
        baseDir: result.baseDir,
        generations: result.generations
      })
    );
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    emit(context, formatBackupListError(format, targetName, normalizeError(error)));
  }
}

// ── backup prune ──────────────────────────────────────────────────────────────

function parseKeep(value: string | undefined): number {
  if (value === undefined) {
    return 10;
  }

  const keep = Number(value);
  if (!Number.isInteger(keep) || keep < 0) {
    throw new CliUsageError("invalid-keep", "--keep must be a non-negative integer.");
  }

  return keep;
}

export async function runBackupPrune(
  targetName: string,
  options: BackupPruneOptions,
  context: CommandContext
): Promise<void> {
  const format = getFormat(options.format);

  try {
    const keep = parseKeep(options.keep);
    const result = await planOrApplyBackupPruneOperation({
      targetName,
      cwd: context.cwd,
      scope: options.scope,
      keep,
      includeOrphans: options.orphans === true,
      apply: options.apply === true,
      env: process.env
    });

    if (result.kind === "dry-run") {
      context.setExitCode(0);
      emit(context, formatBackupPruneDryRun(format, result.plan));
      return;
    }

    context.setExitCode(0);
    emit(context, formatBackupPruneApplied(format, result.plan, result.applied));
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    emit(context, formatBackupPruneError(format, targetName, normalizeError(error)));
  }
}

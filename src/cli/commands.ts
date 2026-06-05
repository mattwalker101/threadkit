import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  auditLibrary,
  applyInstallPlan,
  applyBackupPrunePlan,
  applyRollbackPlan,
  applyUninstallPlan,
  backupGenerationToRollbackManifest,
  buildBackupPrunePlan,
  buildPlan,
  buildRollbackPlan,
  buildUninstallPlan,
  getExportTarget,
  getRenderer,
  InstallPlanUsageError,
  loadBackupIndex,
  loadInstallManifest,
  loadLibrary,
  resolveInstallBaseDir,
  resolveProfile,
  writeExportFiles,
  type AuditWarning,
  type BackupGeneration,
  type BackupPrunePlan,
  type ApplyInstallPlanResult,
  type ApplyUninstallPlanResult,
  type ApplyRollbackPlanResult,
  type ApplyBackupPrunePlanResult,
  type LoadedSkill,
  type RollbackPlan,
  type UninstallPlan,
  type WritePlan
} from "../core/index.js";

export type OutputFormat = "text" | "json";

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
  apply?: boolean;
}

export interface AuditOptions extends RootOptions {
  strict?: boolean;
}

interface CliError {
  code: string;
  message: string;
}

class CliUsageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function getFormat(format: string | undefined): OutputFormat {
  return format === "json" ? "json" : "text";
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

function writeJson(context: CommandContext, value: unknown): void {
  context.write(`${JSON.stringify(value, null, 2)}\n`);
}

// ── Shared text-output helpers ────────────────────────────────────────────────

function writeFileListText(
  context: CommandContext,
  files: Array<{ action: string; path: string }>
): void {
  for (const file of files) {
    context.write(`${file.action}\t${file.path}\n`);
  }
}

function writeDirectoryListText(
  context: CommandContext,
  directories: Array<{ action: string; path: string }>
): void {
  for (const directory of directories) {
    context.write(`${directory.action}\t${directory.path}\n`);
  }
}

function writeGenerationListText(
  context: CommandContext,
  generations: Array<{ action: string; id: string; backupDir: string }>
): void {
  for (const generation of generations) {
    context.write(`${generation.action}\t${generation.id}\t${generation.backupDir}\n`);
  }
}

// ── validate ──────────────────────────────────────────────────────────────────

export async function runValidate(options: RootOptions, context: CommandContext): Promise<void> {
  const root = getRoot(options, context);
  const format = getFormat(options.format);

  try {
    await loadLibrary(root, { canonical: isDefaultRepoRoot(root, options, context) });
    context.setExitCode(0);
    formatValidateSuccess(context, format, root);
  } catch (error) {
    context.setExitCode(1);
    formatValidateError(context, format, root, normalizeError(error));
  }
}

function formatValidateSuccess(context: CommandContext, format: OutputFormat, root: string): void {
  if (format === "json") {
    writeJson(context, { ok: true, root, errors: [], warnings: [] });
    return;
  }
  context.write(`Library is valid: ${root}\n`);
}

function formatValidateError(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  error: CliError
): void {
  if (format === "json") {
    writeJson(context, { ok: false, root, errors: [error], warnings: [] });
    return;
  }
  context.writeError(`Validation failed: ${error.message}\n`);
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
    formatAuditSuccess(context, format, root, result.warnings);
  } catch (error) {
    context.setExitCode(1);
    formatAuditError(context, format, root, normalizeError(error));
  }
}

function formatAuditSuccess(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  warnings: AuditWarning[]
): void {
  if (format === "json") {
    writeJson(context, { ok: true, root, warnings });
    return;
  }

  if (warnings.length === 0) {
    context.write(`Library audit passed: ${root}\n`);
    return;
  }

  context.write(`Library audit warnings: ${root}\n`);
  for (const warning of warnings) {
    context.write(`${warning.code}\t${warning.message}\n`);
  }
}

function formatAuditError(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  error: CliError
): void {
  if (format === "json") {
    writeJson(context, { ok: false, root, errors: [error], warnings: [] });
    return;
  }
  context.writeError(`Audit failed: ${error.message}\n`);
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
    formatListSuccess(context, format, root, skills);
  } catch (error) {
    context.setExitCode(1);
    formatListError(context, format, root, normalizeError(error));
  }
}

function formatListSuccess(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  skills: Array<{ id: string; name: string; summary: string; profiles: string[]; status: string }>
): void {
  if (format === "json") {
    writeJson(context, { ok: true, root, skills });
    return;
  }
  for (const skill of skills) {
    context.write(`${skill.id}\t${skill.name}\t${skill.summary}\n`);
  }
}

function formatListError(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  error: CliError
): void {
  if (format === "json") {
    writeJson(context, { ok: false, root, errors: [error], warnings: [] });
    return;
  }
  context.writeError(`List failed: ${error.message}\n`);
}

// ── show ──────────────────────────────────────────────────────────────────────

function toSkillJson(skill: LoadedSkill) {
  return {
    id: skill.id,
    name: skill.metadata.name,
    version: skill.metadata.version,
    status: skill.metadata.status,
    summary: skill.metadata.summary,
    category: skill.metadata.category,
    triggers: skill.metadata.triggers,
    profiles: skill.metadata.profiles,
    targets: skill.metadata.targets,
    safety: skill.metadata.safety,
    tags: skill.metadata.tags,
    body: skill.body
  };
}

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
    formatShowSuccess(context, format, root, skill);
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    formatShowError(context, format, root, normalizeError(error));
  }
}

function formatShowSuccess(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  skill: LoadedSkill
): void {
  if (format === "json") {
    writeJson(context, { ok: true, root, skill: toSkillJson(skill) });
    return;
  }
  context.write(`${skill.metadata.name} (${skill.id})\n\n${skill.body}`);
}

function formatShowError(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  error: CliError
): void {
  if (format === "json") {
    writeJson(context, { ok: false, root, errors: [error], warnings: [] });
    return;
  }
  context.writeError(`Show failed: ${error.message}\n`);
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
    formatExportSuccess(context, format, root, target.name, profileName, outDir, files, result.warnings);
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    formatExportError(context, format, root, targetName, profileName, normalizeError(error));
  }
}

function formatExportSuccess(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  target: string,
  profile: string,
  outDir: string,
  files: Awaited<ReturnType<typeof writeExportFiles>>,
  warnings: string[]
): void {
  if (format === "json") {
    writeJson(context, { ok: true, root, target, profile, outDir, files, warnings });
    return;
  }
  for (const file of files) {
    context.write(`Exported ${file.relPath} to ${outDir}\n`);
  }
}

function formatExportError(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  target: string,
  profile: string | undefined,
  error: CliError
): void {
  if (format === "json") {
    writeJson(context, { ok: false, root, target, profile, errors: [error], warnings: [] });
    return;
  }
  context.writeError(`Export failed: ${error.message}\n`);
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
    if (!profileName) {
      throw new CliUsageError("missing-profile", "Install requires --profile <name>.");
    }

    const resolvedInstall = resolveInstallBaseDir({
      targetName,
      scope: options.scope,
      cwd: context.cwd,
      env: process.env
    });
    const target = getExportTarget(targetName);

    if (!target) {
      throw new CliUsageError("unsupported-target", `Install target '${targetName}' is not supported.`);
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

    const render = renderer.render({
      profile: profileName,
      target: target.name,
      scope: resolvedInstall.scope,
      skills: resolved.skills
    });
    const plan = await buildPlan({
      target: target.name,
      profile: profileName,
      scope: resolvedInstall.scope,
      baseDir: resolvedInstall.baseDir,
      render,
      managedOnly: true,
      forceForeign: options.force === true
    });
    const hasForeignFiles = plan.files.some((file) => file.action === "skip-foreign");

    if (options.apply !== true || hasForeignFiles) {
      context.setExitCode(hasForeignFiles ? 1 : 0);
      formatInstallDryRun(context, format, root, plan);
      return;
    }

    const applied = await applyInstallPlan({ plan, render });

    context.setExitCode(0);
    formatInstallApplied(context, format, root, plan, applied);
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    formatInstallError(context, format, root, targetName, profileName, normalizeError(error));
  }
}

function formatInstallDryRun(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  plan: WritePlan
): void {
  if (format === "json") {
    writeJson(context, {
      ok: true,
      root,
      target: plan.target,
      profile: plan.profile,
      scope: plan.scope,
      baseDir: plan.baseDir,
      dryRun: true,
      files: plan.files,
      warnings: plan.warnings
    });
    return;
  }
  writeFileListText(context, plan.files);
}

function formatInstallApplied(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  plan: WritePlan,
  applied: ApplyInstallPlanResult
): void {
  const backups = applied.files
    .filter((file) => file.backupPath !== undefined)
    .map((file) => ({ relPath: file.relPath, path: file.path, backupPath: file.backupPath }));

  if (format === "json") {
    writeJson(context, {
      ok: true,
      root,
      target: plan.target,
      profile: plan.profile,
      scope: plan.scope,
      baseDir: plan.baseDir,
      dryRun: false,
      manifestPath: applied.manifestPath,
      files: applied.files,
      backups,
      warnings: plan.warnings
    });
    return;
  }

  writeFileListText(context, applied.files);
  context.write(`manifest\t${applied.manifestPath}\n`);
  for (const backup of backups) {
    context.write(`backup\t${backup.backupPath}\n`);
  }
}

function formatInstallError(
  context: CommandContext,
  format: OutputFormat,
  root: string,
  target: string,
  profile: string | undefined,
  error: CliError
): void {
  if (format === "json") {
    writeJson(context, { ok: false, root, target, profile, errors: [error], warnings: [] });
    return;
  }
  context.writeError(`Install failed: ${error.message}\n`);
}

// ── uninstall ─────────────────────────────────────────────────────────────────

export async function runUninstall(
  targetName: string,
  options: UninstallOptions,
  context: CommandContext
): Promise<void> {
  const format = getFormat(options.format);

  try {
    const resolvedInstall = resolveInstallBaseDir({
      targetName,
      scope: options.scope,
      cwd: context.cwd,
      env: process.env
    });
    const manifest = await loadInstallManifest({ baseDir: resolvedInstall.baseDir });
    const plan = await buildUninstallPlan({
      manifest,
      target: resolvedInstall.target,
      scope: resolvedInstall.scope,
      baseDir: resolvedInstall.baseDir,
      pruneEmptyDirs: options.pruneEmptyDirs === true
    });

    if (options.apply !== true) {
      context.setExitCode(0);
      formatUninstallDryRun(context, format, plan, options.pruneEmptyDirs === true);
      return;
    }

    const applied = await applyUninstallPlan({ plan });

    context.setExitCode(0);
    formatUninstallApplied(context, format, plan, applied, options.pruneEmptyDirs === true);
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    formatUninstallError(context, format, targetName, normalizeError(error));
  }
}

function formatUninstallDryRun(
  context: CommandContext,
  format: OutputFormat,
  plan: UninstallPlan,
  pruneEmptyDirs: boolean
): void {
  if (format === "json") {
    writeJson(context, {
      ok: true,
      target: plan.target,
      profile: plan.profile,
      scope: plan.scope,
      baseDir: plan.baseDir,
      dryRun: true,
      pruneEmptyDirs,
      manifestPath: plan.manifestPath,
      files: plan.files,
      directories: plan.directories,
      warnings: plan.warnings
    });
    return;
  }
  writeFileListText(context, plan.files);
  writeDirectoryListText(context, plan.directories);
}

function formatUninstallApplied(
  context: CommandContext,
  format: OutputFormat,
  plan: UninstallPlan,
  applied: ApplyUninstallPlanResult,
  pruneEmptyDirs: boolean
): void {
  if (format === "json") {
    writeJson(context, {
      ok: true,
      target: plan.target,
      profile: plan.profile,
      scope: plan.scope,
      baseDir: plan.baseDir,
      dryRun: false,
      pruneEmptyDirs,
      manifestPath: applied.manifestPath,
      files: applied.files,
      directories: applied.directories,
      warnings: plan.warnings
    });
    return;
  }
  writeFileListText(context, applied.files);
  writeDirectoryListText(context, applied.directories);
  context.write(`manifest\t${applied.manifestPath}\n`);
}

function formatUninstallError(
  context: CommandContext,
  format: OutputFormat,
  target: string,
  error: CliError
): void {
  if (format === "json") {
    writeJson(context, { ok: false, target, errors: [error], warnings: [] });
    return;
  }
  context.writeError(`Uninstall failed: ${error.message}\n`);
}

// ── rollback ──────────────────────────────────────────────────────────────────

export async function runRollback(
  targetName: string,
  options: RollbackOptions,
  context: CommandContext
): Promise<void> {
  const format = getFormat(options.format);

  try {
    const resolvedInstall = resolveInstallBaseDir({
      targetName,
      scope: options.scope,
      cwd: context.cwd,
      env: process.env
    });
    let manifest;

    if (options.generation === undefined) {
      manifest = await loadInstallManifest({ baseDir: resolvedInstall.baseDir });
    } else {
      const index = await loadBackupIndex({ baseDir: resolvedInstall.baseDir });
      const generation = index.generations.find(
        (candidate) =>
          candidate.id === options.generation &&
          candidate.target === resolvedInstall.target &&
          candidate.scope === resolvedInstall.scope &&
          resolve(candidate.baseDir) === resolve(resolvedInstall.baseDir)
      );

      if (!generation) {
        throw new InstallPlanUsageError(
          "missing-backup-generation",
          `Backup generation '${options.generation}' was not found.`
        );
      }

      manifest = backupGenerationToRollbackManifest(generation);
    }

    const plan = await buildRollbackPlan({
      manifest,
      target: resolvedInstall.target,
      scope: resolvedInstall.scope,
      baseDir: resolvedInstall.baseDir,
      force: options.force === true
    });

    if (options.apply !== true) {
      context.setExitCode(0);
      formatRollbackDryRun(context, format, plan, options.force === true, options.generation);
      return;
    }

    const applied = await applyRollbackPlan({ plan, force: options.force === true });
    const restored = applied.files.filter((file) => file.restored).length;

    context.setExitCode(0);
    formatRollbackApplied(context, format, plan, applied, options.force === true, options.generation, restored);
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    formatRollbackError(context, format, targetName, normalizeError(error));
  }
}

function formatRollbackDryRun(
  context: CommandContext,
  format: OutputFormat,
  plan: RollbackPlan,
  force: boolean,
  generation: string | undefined
): void {
  if (format === "json") {
    writeJson(context, {
      ok: true,
      target: plan.target,
      profile: plan.profile,
      scope: plan.scope,
      baseDir: plan.baseDir,
      dryRun: true,
      force,
      ...(generation === undefined ? {} : { generation }),
      manifestPath: plan.manifestPath,
      files: plan.files,
      warnings: plan.warnings
    });
    return;
  }
  writeFileListText(context, plan.files);
}

function formatRollbackApplied(
  context: CommandContext,
  format: OutputFormat,
  plan: RollbackPlan,
  applied: ApplyRollbackPlanResult,
  force: boolean,
  generation: string | undefined,
  restored: number
): void {
  if (format === "json") {
    writeJson(context, {
      ok: true,
      target: plan.target,
      profile: plan.profile,
      scope: plan.scope,
      baseDir: plan.baseDir,
      dryRun: false,
      force,
      ...(generation === undefined ? {} : { generation }),
      manifestPath: applied.manifestPath,
      files: applied.files,
      restored,
      warnings: plan.warnings
    });
    return;
  }
  writeFileListText(context, applied.files);
  context.write(`manifest\t${applied.manifestPath}\n`);
}

function formatRollbackError(
  context: CommandContext,
  format: OutputFormat,
  target: string,
  error: CliError
): void {
  if (format === "json") {
    writeJson(context, { ok: false, target, errors: [error], warnings: [] });
    return;
  }
  context.writeError(`Rollback failed: ${error.message}\n`);
}

// ── backup list ───────────────────────────────────────────────────────────────

export async function runBackupList(
  targetName: string,
  options: BackupListOptions,
  context: CommandContext
): Promise<void> {
  const format = getFormat(options.format);

  try {
    const resolvedInstall = resolveInstallBaseDir({
      targetName,
      scope: options.scope,
      cwd: context.cwd,
      env: process.env
    });
    const index = await loadBackupIndex({ baseDir: resolvedInstall.baseDir });
    const generations = index.generations.filter(
      (generation) =>
        generation.target === resolvedInstall.target &&
        generation.scope === resolvedInstall.scope &&
        resolve(generation.baseDir) === resolve(resolvedInstall.baseDir)
    );

    context.setExitCode(0);
    formatBackupListSuccess(
      context,
      format,
      resolvedInstall.target,
      resolvedInstall.scope,
      resolvedInstall.baseDir,
      generations
    );
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    formatBackupListError(context, format, targetName, normalizeError(error));
  }
}

function formatBackupListSuccess(
  context: CommandContext,
  format: OutputFormat,
  target: string,
  scope: string,
  baseDir: string,
  generations: BackupGeneration[]
): void {
  if (format === "json") {
    writeJson(context, { ok: true, target, scope, baseDir, generations });
    return;
  }
  for (const generation of generations) {
    context.write(`${generation.id}\t${generation.installedAt}\t${generation.profile}\t${generation.backupDir}\n`);
  }
}

function formatBackupListError(
  context: CommandContext,
  format: OutputFormat,
  target: string,
  error: CliError
): void {
  if (format === "json") {
    writeJson(context, { ok: false, target, errors: [error], warnings: [] });
    return;
  }
  context.writeError(`Backups list failed: ${error.message}\n`);
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
    const resolvedInstall = resolveInstallBaseDir({
      targetName,
      scope: options.scope,
      cwd: context.cwd,
      env: process.env
    });
    const index = await loadBackupIndex({ baseDir: resolvedInstall.baseDir });
    const plan = buildBackupPrunePlan({
      index,
      baseDir: resolvedInstall.baseDir,
      target: resolvedInstall.target,
      scope: resolvedInstall.scope,
      keep
    });

    if (options.apply !== true) {
      context.setExitCode(0);
      formatBackupPruneDryRun(context, format, plan);
      return;
    }

    const applied = await applyBackupPrunePlan({ plan });

    context.setExitCode(0);
    formatBackupPruneApplied(context, format, plan, applied);
  } catch (error) {
    context.setExitCode(isUsageError(error) ? 2 : 1);
    formatBackupPruneError(context, format, targetName, normalizeError(error));
  }
}

function formatBackupPruneDryRun(
  context: CommandContext,
  format: OutputFormat,
  plan: BackupPrunePlan
): void {
  if (format === "json") {
    writeJson(context, {
      ok: true,
      target: plan.target,
      scope: plan.scope,
      baseDir: plan.baseDir,
      dryRun: true,
      keep: plan.keep,
      generations: plan.generations,
      retained: plan.retained,
      warnings: plan.warnings
    });
    return;
  }
  writeGenerationListText(context, plan.generations);
}

function formatBackupPruneApplied(
  context: CommandContext,
  format: OutputFormat,
  plan: BackupPrunePlan,
  applied: ApplyBackupPrunePlanResult
): void {
  if (format === "json") {
    writeJson(context, {
      ok: true,
      target: plan.target,
      scope: plan.scope,
      baseDir: plan.baseDir,
      dryRun: false,
      keep: plan.keep,
      indexPath: applied.indexPath,
      generations: applied.generations,
      retained: applied.retained,
      warnings: plan.warnings
    });
    return;
  }
  writeGenerationListText(context, applied.generations);
  context.write(`index\t${applied.indexPath}\n`);
}

function formatBackupPruneError(
  context: CommandContext,
  format: OutputFormat,
  target: string,
  error: CliError
): void {
  if (format === "json") {
    writeJson(context, { ok: false, target, errors: [error], warnings: [] });
    return;
  }
  context.writeError(`Backups prune failed: ${error.message}\n`);
}

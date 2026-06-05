import type {
  ApplyBackupPrunePlanResult,
  ApplyInstallPlanResult,
  ApplyRollbackPlanResult,
  ApplyUninstallPlanResult,
  AuditWarning,
  BackupGeneration,
  BackupPrunePlan,
  LoadedSkill,
  RollbackPlan,
  UninstallPlan,
  WritePlan,
  writeExportFiles
} from "../core/index.js";

export type OutputFormat = "text" | "json";

export interface CliError {
  code: string;
  message: string;
}

export interface CommandOutput {
  stream: "stdout" | "stderr";
  text: string;
}

type ExportedFiles = Awaited<ReturnType<typeof writeExportFiles>>;

function stdout(text: string): CommandOutput {
  return { stream: "stdout", text };
}

function stderr(text: string): CommandOutput {
  return { stream: "stderr", text };
}

function json(value: unknown): CommandOutput {
  return stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function fileListText(files: Array<{ action: string; path: string }>): string {
  return files.map((file) => `${file.action}\t${file.path}\n`).join("");
}

function directoryListText(directories: Array<{ action: string; path: string }>): string {
  return directories.map((directory) => `${directory.action}\t${directory.path}\n`).join("");
}

function generationListText(generations: Array<{ action: string; id: string; backupDir: string }>): string {
  return generations.map((generation) => `${generation.action}\t${generation.id}\t${generation.backupDir}\n`).join("");
}

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

export function getFormat(format: string | undefined): OutputFormat {
  return format === "json" ? "json" : "text";
}

export function formatValidateSuccess(format: OutputFormat, root: string): CommandOutput {
  if (format === "json") {
    return json({ ok: true, root, errors: [], warnings: [] });
  }

  return stdout(`Library is valid: ${root}\n`);
}

export function formatValidateError(format: OutputFormat, root: string, error: CliError): CommandOutput {
  if (format === "json") {
    return json({ ok: false, root, errors: [error], warnings: [] });
  }

  return stderr(`Validation failed: ${error.message}\n`);
}

export function formatAuditSuccess(
  format: OutputFormat,
  root: string,
  warnings: AuditWarning[]
): CommandOutput {
  if (format === "json") {
    return json({ ok: true, root, warnings });
  }

  if (warnings.length === 0) {
    return stdout(`Library audit passed: ${root}\n`);
  }

  const details = warnings.map((warning) => `${warning.code}\t${warning.message}\n`).join("");
  return stdout(`Library audit warnings: ${root}\n${details}`);
}

export function formatAuditError(format: OutputFormat, root: string, error: CliError): CommandOutput {
  if (format === "json") {
    return json({ ok: false, root, errors: [error], warnings: [] });
  }

  return stderr(`Audit failed: ${error.message}\n`);
}

export function formatListSuccess(
  format: OutputFormat,
  root: string,
  skills: Array<{ id: string; name: string; summary: string; profiles: string[]; status: string }>
): CommandOutput {
  if (format === "json") {
    return json({ ok: true, root, skills });
  }

  return stdout(skills.map((skill) => `${skill.id}\t${skill.name}\t${skill.summary}\n`).join(""));
}

export function formatListError(format: OutputFormat, root: string, error: CliError): CommandOutput {
  if (format === "json") {
    return json({ ok: false, root, errors: [error], warnings: [] });
  }

  return stderr(`List failed: ${error.message}\n`);
}

export function formatShowSuccess(format: OutputFormat, root: string, skill: LoadedSkill): CommandOutput {
  if (format === "json") {
    return json({ ok: true, root, skill: toSkillJson(skill) });
  }

  return stdout(`${skill.metadata.name} (${skill.id})\n\n${skill.body}`);
}

export function formatShowError(format: OutputFormat, root: string, error: CliError): CommandOutput {
  if (format === "json") {
    return json({ ok: false, root, errors: [error], warnings: [] });
  }

  return stderr(`Show failed: ${error.message}\n`);
}

export function formatExportSuccess(args: {
  format: OutputFormat;
  root: string;
  target: string;
  profile: string;
  outDir: string;
  files: ExportedFiles;
  warnings: string[];
}): CommandOutput {
  if (args.format === "json") {
    return json({
      ok: true,
      root: args.root,
      target: args.target,
      profile: args.profile,
      outDir: args.outDir,
      files: args.files,
      warnings: args.warnings
    });
  }

  return stdout(args.files.map((file) => `Exported ${file.relPath} to ${args.outDir}\n`).join(""));
}

export function formatExportError(args: {
  format: OutputFormat;
  root: string;
  target: string;
  profile: string | undefined;
  error: CliError;
}): CommandOutput {
  if (args.format === "json") {
    return json({
      ok: false,
      root: args.root,
      target: args.target,
      profile: args.profile,
      errors: [args.error],
      warnings: []
    });
  }

  return stderr(`Export failed: ${args.error.message}\n`);
}

export function formatInstallDryRun(format: OutputFormat, root: string, plan: WritePlan): CommandOutput {
  if (format === "json") {
    return json({
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
  }

  return stdout(fileListText(plan.files));
}

export function formatInstallApplied(
  format: OutputFormat,
  root: string,
  plan: WritePlan,
  applied: ApplyInstallPlanResult
): CommandOutput {
  const backups = applied.files
    .filter((file) => file.backupPath !== undefined)
    .map((file) => ({ relPath: file.relPath, path: file.path, backupPath: file.backupPath }));

  if (format === "json") {
    return json({
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
  }

  const backupText = backups.map((backup) => `backup\t${backup.backupPath}\n`).join("");
  return stdout(`${fileListText(applied.files)}manifest\t${applied.manifestPath}\n${backupText}`);
}

export function formatInstallError(args: {
  format: OutputFormat;
  root: string;
  target: string;
  profile: string | undefined;
  error: CliError;
}): CommandOutput {
  if (args.format === "json") {
    return json({
      ok: false,
      root: args.root,
      target: args.target,
      profile: args.profile,
      errors: [args.error],
      warnings: []
    });
  }

  return stderr(`Install failed: ${args.error.message}\n`);
}

export function formatUninstallDryRun(
  format: OutputFormat,
  plan: UninstallPlan,
  pruneEmptyDirs: boolean
): CommandOutput {
  if (format === "json") {
    return json({
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
  }

  return stdout(`${fileListText(plan.files)}${directoryListText(plan.directories)}`);
}

export function formatUninstallApplied(
  format: OutputFormat,
  plan: UninstallPlan,
  applied: ApplyUninstallPlanResult,
  pruneEmptyDirs: boolean
): CommandOutput {
  if (format === "json") {
    return json({
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
  }

  return stdout(`${fileListText(applied.files)}${directoryListText(applied.directories)}manifest\t${applied.manifestPath}\n`);
}

export function formatUninstallError(format: OutputFormat, target: string, error: CliError): CommandOutput {
  if (format === "json") {
    return json({ ok: false, target, errors: [error], warnings: [] });
  }

  return stderr(`Uninstall failed: ${error.message}\n`);
}

export function formatRollbackDryRun(args: {
  format: OutputFormat;
  plan: RollbackPlan;
  force: boolean;
  generation: string | undefined;
}): CommandOutput {
  if (args.format === "json") {
    return json({
      ok: true,
      target: args.plan.target,
      profile: args.plan.profile,
      scope: args.plan.scope,
      baseDir: args.plan.baseDir,
      dryRun: true,
      force: args.force,
      ...(args.generation === undefined ? {} : { generation: args.generation }),
      manifestPath: args.plan.manifestPath,
      files: args.plan.files,
      warnings: args.plan.warnings
    });
  }

  return stdout(fileListText(args.plan.files));
}

export function formatRollbackApplied(args: {
  format: OutputFormat;
  plan: RollbackPlan;
  applied: ApplyRollbackPlanResult;
  force: boolean;
  generation: string | undefined;
  restored: number;
}): CommandOutput {
  if (args.format === "json") {
    return json({
      ok: true,
      target: args.plan.target,
      profile: args.plan.profile,
      scope: args.plan.scope,
      baseDir: args.plan.baseDir,
      dryRun: false,
      force: args.force,
      ...(args.generation === undefined ? {} : { generation: args.generation }),
      manifestPath: args.applied.manifestPath,
      files: args.applied.files,
      restored: args.restored,
      warnings: args.plan.warnings
    });
  }

  return stdout(`${fileListText(args.applied.files)}manifest\t${args.applied.manifestPath}\n`);
}

export function formatRollbackError(format: OutputFormat, target: string, error: CliError): CommandOutput {
  if (format === "json") {
    return json({ ok: false, target, errors: [error], warnings: [] });
  }

  return stderr(`Rollback failed: ${error.message}\n`);
}

export function formatBackupListSuccess(args: {
  format: OutputFormat;
  target: string;
  scope: string;
  baseDir: string;
  generations: BackupGeneration[];
}): CommandOutput {
  if (args.format === "json") {
    return json({
      ok: true,
      target: args.target,
      scope: args.scope,
      baseDir: args.baseDir,
      generations: args.generations
    });
  }

  const text = args.generations
    .map((generation) => `${generation.id}\t${generation.installedAt}\t${generation.profile}\t${generation.backupDir}\n`)
    .join("");
  return stdout(text);
}

export function formatBackupListError(format: OutputFormat, target: string, error: CliError): CommandOutput {
  if (format === "json") {
    return json({ ok: false, target, errors: [error], warnings: [] });
  }

  return stderr(`Backups list failed: ${error.message}\n`);
}

export function formatBackupPruneDryRun(format: OutputFormat, plan: BackupPrunePlan): CommandOutput {
  if (format === "json") {
    return json({
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
  }

  return stdout(generationListText(plan.generations));
}

export function formatBackupPruneApplied(
  format: OutputFormat,
  plan: BackupPrunePlan,
  applied: ApplyBackupPrunePlanResult
): CommandOutput {
  if (format === "json") {
    return json({
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
  }

  return stdout(`${generationListText(applied.generations)}index\t${applied.indexPath}\n`);
}

export function formatBackupPruneError(format: OutputFormat, target: string, error: CliError): CommandOutput {
  if (format === "json") {
    return json({ ok: false, target, errors: [error], warnings: [] });
  }

  return stderr(`Backups prune failed: ${error.message}\n`);
}

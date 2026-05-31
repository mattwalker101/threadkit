import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getExportTarget,
  getRenderer,
  loadLibrary,
  resolveProfile,
  writeExportFiles,
  type LoadedSkill
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

  return {
    code: "validation-error",
    message: error instanceof Error ? error.message : String(error)
  };
}

function writeJson(context: CommandContext, value: unknown): void {
  context.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runValidate(options: RootOptions, context: CommandContext): Promise<void> {
  const root = getRoot(options, context);
  const format = getFormat(options.format);

  try {
    await loadLibrary(root, { canonical: isDefaultRepoRoot(root, options, context) });
    context.setExitCode(0);

    if (format === "json") {
      writeJson(context, { ok: true, root, errors: [], warnings: [] });
      return;
    }

    context.write(`Library is valid: ${root}\n`);
  } catch (error) {
    const normalized = normalizeError(error);
    context.setExitCode(1);

    if (format === "json") {
      writeJson(context, { ok: false, root, errors: [normalized], warnings: [] });
      return;
    }

    context.writeError(`Validation failed: ${normalized.message}\n`);
  }
}

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

    if (format === "json") {
      writeJson(context, { ok: true, root, skills });
      return;
    }

    for (const skill of skills) {
      context.write(`${skill.id}\t${skill.name}\t${skill.summary}\n`);
    }
  } catch (error) {
    const normalized = normalizeError(error);
    context.setExitCode(1);

    if (format === "json") {
      writeJson(context, { ok: false, root, errors: [normalized], warnings: [] });
      return;
    }

    context.writeError(`List failed: ${normalized.message}\n`);
  }
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

    if (format === "json") {
      writeJson(context, { ok: true, root, skill: toSkillJson(skill) });
      return;
    }

    context.write(`${skill.metadata.name} (${skill.id})\n\n${skill.body}`);
  } catch (error) {
    const normalized = normalizeError(error);
    context.setExitCode(error instanceof CliUsageError ? 2 : 1);

    if (format === "json") {
      writeJson(context, { ok: false, root, errors: [normalized], warnings: [] });
      return;
    }

    context.writeError(`Show failed: ${normalized.message}\n`);
  }
}

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

    if (format === "json") {
      writeJson(context, {
        ok: true,
        root,
        target: target.name,
        profile: profileName,
        outDir,
        files,
        warnings: result.warnings
      });
      return;
    }

    for (const file of files) {
      context.write(`Exported ${file.relPath} to ${outDir}\n`);
    }
  } catch (error) {
    const normalized = normalizeError(error);
    context.setExitCode(error instanceof CliUsageError ? 2 : 1);

    if (format === "json") {
      writeJson(context, {
        ok: false,
        root,
        target: targetName,
        profile: profileName,
        errors: [normalized],
        warnings: []
      });
      return;
    }

    context.writeError(`Export failed: ${normalized.message}\n`);
  }
}

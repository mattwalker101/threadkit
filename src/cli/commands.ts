import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadLibrary } from "../core/index.js";

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

interface CliError {
  code: string;
  message: string;
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

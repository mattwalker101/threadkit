import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { FileSpec } from "./renderTypes.js";

export function resolveSafePathInside(baseDir: string, relPath: string, label = "Path"): string {
  const resolvedBase = resolve(baseDir);
  const outputPath = resolve(resolvedBase, relPath);
  const prefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;

  if (outputPath !== resolvedBase && !outputPath.startsWith(prefix)) {
    throw new Error(`${label} '${relPath}' escapes the base directory.`);
  }

  return outputPath;
}

export function isInsideDirectory(baseDir: string, candidatePath: string): boolean {
  const resolvedBase = resolve(baseDir);
  const resolvedCandidate = resolve(candidatePath);
  const prefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  return resolvedCandidate !== resolvedBase && resolvedCandidate.startsWith(prefix);
}

export async function contentForSpec(file: FileSpec): Promise<Buffer | string> {
  if (file.content !== undefined) {
    return file.content;
  }

  if (file.copySource !== undefined) {
    return readFile(file.copySource);
  }

  throw new Error(`File '${file.relPath}' must define content or copySource.`);
}

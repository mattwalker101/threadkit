import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { FileSpec, WrittenFile } from "./renderTypes.js";

function resolveInsideOutDir(outDir: string, relPath: string): string {
  const resolvedOutDir = resolve(outDir);
  const outputPath = resolve(resolvedOutDir, relPath);
  const prefix = resolvedOutDir.endsWith(sep) ? resolvedOutDir : `${resolvedOutDir}${sep}`;

  if (outputPath !== resolvedOutDir && !outputPath.startsWith(prefix)) {
    throw new Error(`Export file path '${relPath}' escapes the output directory.`);
  }

  return outputPath;
}

async function contentForSpec(file: FileSpec): Promise<Buffer | string> {
  if (file.content !== undefined) {
    return file.content;
  }

  if (file.copySource !== undefined) {
    return readFile(file.copySource);
  }

  throw new Error(`Export file '${file.relPath}' must define content or copySource.`);
}

export async function writeExportFiles(args: { outDir: string; files: FileSpec[] }): Promise<WrittenFile[]> {
  const written: WrittenFile[] = [];

  for (const file of args.files) {
    const outputPath = resolveInsideOutDir(args.outDir, file.relPath);
    const content = await contentForSpec(file);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);

    written.push({
      path: outputPath,
      relPath: file.relPath,
      marker: file.marker,
      bytes: Buffer.byteLength(content)
    });
  }

  return written;
}

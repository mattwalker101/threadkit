import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { contentForSpec, resolveSafePathInside } from "./resolveSafePath.js";
import type { FileSpec, WrittenFile } from "./renderTypes.js";

export async function writeExportFiles(args: { outDir: string; files: FileSpec[] }): Promise<WrittenFile[]> {
  const written: WrittenFile[] = [];

  for (const file of args.files) {
    const outputPath = resolveSafePathInside(args.outDir, file.relPath, "Export file path");
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

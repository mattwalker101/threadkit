import { resolve } from "node:path";
import type { BackupGeneration, BackupIndex, InstallScope } from "./planTypes.js";
import { newestGenerationsFirst } from "./planHelpers.js";

export interface BackupGenerationInstallSelector {
  target: string;
  scope: InstallScope;
  baseDir: string;
}

export function backupGenerationMatchesInstall(
  generation: BackupGeneration,
  install: BackupGenerationInstallSelector
): boolean {
  return (
    generation.target === install.target &&
    generation.scope === install.scope &&
    resolve(generation.baseDir) === resolve(install.baseDir)
  );
}

export function matchingBackupGenerations(
  index: BackupIndex,
  install: BackupGenerationInstallSelector
): BackupGeneration[] {
  return newestGenerationsFirst(
    index.generations.filter((generation) => backupGenerationMatchesInstall(generation, install))
  );
}

export function findBackupGeneration(
  index: BackupIndex,
  install: BackupGenerationInstallSelector,
  generationId: string
): BackupGeneration | undefined {
  return matchingBackupGenerations(index, install).find((generation) => generation.id === generationId);
}

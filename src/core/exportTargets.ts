export interface ExportTarget {
  name: string;
  format: string;
  distSubdir: string;
}

export const exportTargets = {
  markdown: {
    name: "markdown",
    format: "markdown",
    distSubdir: "markdown"
  }
} as const satisfies Record<string, ExportTarget>;

export type ExportTargetName = keyof typeof exportTargets;

export function getExportTarget(target: string): ExportTarget | undefined {
  return exportTargets[target as ExportTargetName];
}

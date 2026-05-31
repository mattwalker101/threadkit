export interface ExportTarget {
  name: string;
  format: string;
  distSubdir: string;
  paths?: {
    user?: string;
    project?: string;
  };
}

export const exportTargets = {
  markdown: {
    name: "markdown",
    format: "markdown",
    distSubdir: "markdown"
  },
  claude: {
    name: "claude",
    format: "skill",
    distSubdir: "claude",
    paths: {
      user: "~/.claude/skills",
      project: "./.claude/skills"
    }
  },
  antigravity: {
    name: "antigravity",
    format: "skill",
    distSubdir: "antigravity",
    paths: {
      user: "~/.gemini/skills",
      project: "./.agents/skills"
    }
  }
} as const satisfies Record<string, ExportTarget>;

export type ExportTargetName = keyof typeof exportTargets;

export function getExportTarget(target: string): ExportTarget | undefined {
  return exportTargets[target as ExportTargetName];
}

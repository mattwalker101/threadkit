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
  },
  codex: {
    name: "codex",
    format: "agents-md",
    distSubdir: "codex",
    paths: {
      project: "./AGENTS.md"
    }
  },
  opencode: {
    name: "opencode",
    format: "opencode-command",
    distSubdir: "opencode",
    paths: {
      user: "~/.config/opencode/command",
      project: "./.opencode/command"
    }
  },
  gemini: {
    name: "gemini",
    format: "gemini-toml",
    distSubdir: "gemini",
    paths: {
      user: "~/.gemini/commands",
      project: "./.gemini/commands"
    }
  }
} as const satisfies Record<string, ExportTarget>;

export type ExportTargetName = keyof typeof exportTargets;

export function getExportTarget(target: string): ExportTarget | undefined {
  return exportTargets[target as ExportTargetName];
}

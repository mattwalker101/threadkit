export interface ExportTarget {
  name: string;
  format: string;
  distSubdir: string;
  paths?: {
    user?: string;
    project?: string;
  };
  install?: {
    stripRelPathPrefix?: string;
    kind?: "directory" | "file";
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
    },
    install: {
      stripRelPathPrefix: "claude/skills"
    }
  },
  antigravity: {
    name: "antigravity",
    format: "skill",
    distSubdir: "antigravity",
    paths: {
      user: "~/.gemini/skills",
      project: "./.agents/skills"
    },
    install: {
      stripRelPathPrefix: "antigravity/skills"
    }
  },
  codex: {
    name: "codex",
    format: "agents-md",
    distSubdir: "codex",
    paths: {
      project: "./AGENTS.md"
    },
    install: {
      kind: "file",
      stripRelPathPrefix: "codex"
    }
  },
  opencode: {
    name: "opencode",
    format: "opencode-command",
    distSubdir: "opencode",
    paths: {
      user: "~/.config/opencode/command",
      project: "./.opencode/command"
    },
    install: {
      stripRelPathPrefix: "opencode/command"
    }
  },
  gemini: {
    name: "gemini",
    format: "gemini-toml",
    distSubdir: "gemini",
    paths: {
      user: "~/.gemini/commands",
      project: "./.gemini/commands"
    },
    install: {
      stripRelPathPrefix: "gemini/commands"
    }
  }
} as const satisfies Record<string, ExportTarget>;

export type ExportTargetName = keyof typeof exportTargets;

export function getExportTarget(target: string): ExportTarget | undefined {
  return exportTargets[target as ExportTargetName];
}

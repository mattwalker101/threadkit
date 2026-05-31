import { describe, expect, it } from "vitest";
import {
  profileSchema,
  skillIdSchema,
  skillSchema,
  targetMapSchema
} from "../src/schema/index.js";

const validSkill = {
  id: "implementation-plan",
  name: "Implementation Plan",
  version: "0.1.0",
  status: "draft",
  summary: "Turns a project idea into an agent-ready implementation plan.",
  category: "coding",
  triggers: ["create an implementation plan", "turn this into a build plan"],
  profiles: ["minimal", "coding-heavy"],
  targets: {
    claude: { enabled: true },
    antigravity: { enabled: true },
    codex: { enabled: true },
    opencode: { enabled: true },
    gemini: { enabled: false },
    markdown: { enabled: true }
  },
  safety: {
    allow_shell_commands: false,
    allow_network: false,
    allow_file_writes: false,
    includes_scripts: false
  },
  tags: ["planning", "architecture"]
};

describe("skill schemas", () => {
  it("accepts a valid canonical skill", () => {
    expect(skillSchema.parse(validSkill)).toEqual(validSkill);
  });

  it("requires kebab-case skill ids", () => {
    expect(skillIdSchema.safeParse("implementation-plan").success).toBe(true);
    expect(skillIdSchema.safeParse("ImplementationPlan").success).toBe(false);
    expect(skillIdSchema.safeParse("implementation-").success).toBe(false);
  });

  it("rejects summaries over 1024 characters", () => {
    const result = skillSchema.safeParse({
      ...validSkill,
      summary: "a".repeat(1025)
    });

    expect(result.success).toBe(false);
  });

  it("requires 2 to 10 triggers", () => {
    expect(skillSchema.safeParse({ ...validSkill, triggers: ["one"] }).success).toBe(false);
    expect(
      skillSchema.safeParse({
        ...validSkill,
        triggers: Array.from({ length: 11 }, (_, index) => `trigger ${index}`)
      }).success
    ).toBe(false);
  });

  it("rejects unknown metadata fields", () => {
    expect(skillSchema.safeParse({ ...validSkill, unexpected: true }).success).toBe(false);
  });
});

describe("profile schema", () => {
  it("accepts a valid profile declaration", () => {
    const profile = {
      name: "minimal",
      description: "Smallest useful baseline.",
      skills: ["implementation-plan", "build-handoff"]
    };

    expect(profileSchema.parse(profile)).toEqual(profile);
  });

  it("rejects duplicate skill entries", () => {
    const result = profileSchema.safeParse({
      name: "minimal",
      description: "Smallest useful baseline.",
      skills: ["implementation-plan", "implementation-plan"]
    });

    expect(result.success).toBe(false);
  });
});

describe("target map schema", () => {
  it("accepts target records that decouple target names from renderer formats", () => {
    const targetMap = {
      claude: {
        name: "claude",
        format: "skill",
        distSubdir: "claude",
        paths: {
          user: "~/.claude/skills",
          project: "./.claude/skills"
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
      markdown: {
        name: "markdown",
        format: "markdown",
        distSubdir: "markdown"
      }
    };

    expect(targetMapSchema.parse(targetMap)).toEqual(targetMap);
  });

  it("rejects unknown renderer formats and install targets without install paths", () => {
    expect(
      targetMapSchema.safeParse({
        claude: {
          name: "claude",
          format: "unknown",
          distSubdir: "claude",
          paths: {
            user: "~/.claude/skills"
          }
        }
      }).success
    ).toBe(false);

    expect(
      targetMapSchema.safeParse({
        claude: {
          name: "claude",
          format: "skill",
          distSubdir: "claude",
          paths: {}
        }
      }).success
    ).toBe(false);
  });

  it("requires target map keys to match target record names", () => {
    const result = targetMapSchema.safeParse({
      claude: {
        name: "codex",
        format: "skill",
        distSubdir: "claude",
        paths: {
          user: "~/.claude/skills"
        }
      }
    });

    expect(result.success).toBe(false);
  });
});

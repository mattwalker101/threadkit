import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedLibrary } from "./loadLibrary.js";
import type { LoadedSkill } from "./loadSkill.js";

export interface AuditWarning {
  code: string;
  message: string;
  skill?: string;
  relatedSkills?: string[];
}

export interface AuditResult {
  warnings: AuditWarning[];
}

const weakTriggers = new Set(["help", "fix", "do this", "process", "use this", "run this"]);
const bodyLineLimit = 500;
const stopWords = new Set(["a", "an", "and", "for", "the", "to"]);

export async function auditLibrary(library: LoadedLibrary): Promise<AuditResult> {
  const warnings: AuditWarning[] = [];

  for (const skill of library.skills) {
    warnings.push(...(await auditSkill(skill)));
  }

  warnings.push(...auditTriggerOverlap(library.skills));

  return {
    warnings: warnings.sort(compareWarnings)
  };
}

async function auditSkill(skill: LoadedSkill): Promise<AuditWarning[]> {
  const warnings: AuditWarning[] = [];
  const body = skill.body;
  const bodyTextLines = body.replace(/\r\n/g, "\n").split("\n");
  const bodyLines = bodyTextLines.length;
  const normalizedHeadings = new Set(
    bodyTextLines
      .map((line) => /^##\s+(.+?)\s*$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " "))
  );
  const lowerBody = body.toLowerCase();

  if (bodyLines > bodyLineLimit) {
    warnings.push({
      code: "body-too-long",
      message: `Skill '${skill.id}' body.md has ${bodyLines} lines, above the ${bodyLineLimit}-line audit target.`,
      skill: skill.id
    });
  }

  if (!normalizedHeadings.has("output format")) {
    warnings.push({
      code: "missing-output-format-anchor",
      message: `Skill '${skill.id}' is missing a '## Output format' section.`,
      skill: skill.id
    });
  }

  if (!normalizedHeadings.has("what not to do")) {
    warnings.push({
      code: "missing-what-not-to-do-anchor",
      message: `Skill '${skill.id}' is missing a '## What not to do' section.`,
      skill: skill.id
    });
  }

  for (const trigger of skill.metadata.triggers) {
    const normalizedTrigger = trigger.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

    if (weakTriggers.has(normalizedTrigger)) {
      warnings.push({
        code: "weak-trigger",
        message: `Skill '${skill.id}' has a low-information trigger: '${trigger}'.`,
        skill: skill.id
      });
    }
  }

  if (!skill.metadata.safety.allow_shell_commands && mentionsShell(lowerBody)) {
    warnings.push({
      code: "safety-shell-mismatch",
      message: `Skill '${skill.id}' mentions shell command behavior but safety.allow_shell_commands is false.`,
      skill: skill.id
    });
  }

  if (!skill.metadata.safety.allow_network && mentionsNetwork(lowerBody)) {
    warnings.push({
      code: "safety-network-mismatch",
      message: `Skill '${skill.id}' mentions network behavior but safety.allow_network is false.`,
      skill: skill.id
    });
  }

  if (!skill.metadata.safety.allow_file_writes && mentionsFileWrites(lowerBody)) {
    warnings.push({
      code: "safety-file-writes-mismatch",
      message: `Skill '${skill.id}' mentions file-write behavior but safety.allow_file_writes is false.`,
      skill: skill.id
    });
  }

  if (await hasDirectoryPayload(skill, "assets")) {
    warnings.push({
      code: "asset-payload-present",
      message: `Skill '${skill.id}' includes asset payload files.`,
      skill: skill.id
    });
  }

  if (await hasDirectoryPayload(skill, "scripts")) {
    warnings.push({
      code: "scripts-present",
      message: `Skill '${skill.id}' includes script payload files.`,
      skill: skill.id
    });

    if (!skill.metadata.safety.includes_scripts) {
      warnings.push({
        code: "safety-scripts-mismatch",
        message: `Skill '${skill.id}' includes scripts but safety.includes_scripts is false.`,
        skill: skill.id
      });
    }
  }

  return warnings;
}

function auditTriggerOverlap(skills: LoadedSkill[]): AuditWarning[] {
  const warnings: AuditWarning[] = [];

  for (let leftIndex = 0; leftIndex < skills.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < skills.length; rightIndex += 1) {
      const left = skills[leftIndex];
      const right = skills[rightIndex];

      if (left && right && hasOverlappingTriggers(left, right)) {
        warnings.push({
          code: "overlapping-trigger",
          message: `Skills '${left.id}' and '${right.id}' have overlapping activation triggers.`,
          skill: left.id,
          relatedSkills: [right.id]
        });
      }
    }
  }

  return warnings;
}

function hasOverlappingTriggers(left: LoadedSkill, right: LoadedSkill): boolean {
  const tokensFor = (value: string): string[] =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .split(" ")
      .filter((token) => token.length > 0 && !stopWords.has(token));

  for (const leftTrigger of left.metadata.triggers) {
    const leftTokens = tokensFor(leftTrigger);
    const leftKey = leftTokens.join(" ");

    for (const rightTrigger of right.metadata.triggers) {
      const rightTokens = tokensFor(rightTrigger);
      const rightKey = rightTokens.join(" ");

      if (leftKey.length > 0 && leftKey === rightKey) {
        return true;
      }

      const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
      const denominator = Math.max(leftTokens.length, rightTokens.length);

      if (denominator >= 3 && overlap / denominator >= 0.8) {
        return true;
      }
    }
  }

  return false;
}

function mentionsShell(body: string): boolean {
  return /`[^`]*(curl|npm|pnpm|yarn|git|rm|mkdir|cp|mv|python|node|bash|sh)[^`]*`/.test(body)
    || /\b(shell|terminal|command line|run command|execute command)\b/.test(body);
}

function mentionsNetwork(body: string): boolean {
  return /\b(curl|wget|http:\/\/|https:\/\/|fetch|download|network)\b/.test(body);
}

function mentionsFileWrites(body: string): boolean {
  return /\b(write|create|edit|modify|delete|remove|save)\b.{0,40}\b(file|files|disk|directory|directories|folder|folders|report)\b/.test(body)
    || /\b(file writes?|write files?|writes to disk)\b/.test(body);
}

async function hasDirectoryPayload(skill: LoadedSkill, directoryName: "assets" | "scripts"): Promise<boolean> {
  try {
    const entries = await readdir(join(skill.dir, directoryName), { recursive: true, withFileTypes: true });
    return entries.some((entry) => entry.isFile());
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function compareWarnings(left: AuditWarning, right: AuditWarning): number {
  return (
    (left.skill ?? "").localeCompare(right.skill ?? "") ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message) ||
    (left.relatedSkills ?? []).join(",").localeCompare((right.relatedSkills ?? []).join(","))
  );
}

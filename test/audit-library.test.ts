import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditLibrary, loadLibrary } from "../src/core/index.js";

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "threadkit-audit-"));
}

function skillYml(args: {
  id: string;
  triggers?: string[];
  safety?: {
    allow_shell_commands: boolean;
    allow_network: boolean;
    allow_file_writes: boolean;
    includes_scripts: boolean;
  };
}): string {
  const triggers = args.triggers ?? [`use ${args.id}`, `run ${args.id}`];
  const safety = args.safety ?? {
    allow_shell_commands: false,
    allow_network: false,
    allow_file_writes: false,
    includes_scripts: false
  };

  return `id: ${args.id}
name: ${args.id}
version: 0.1.0
status: draft
summary: Audits ${args.id}.
category: quality
triggers:
${triggers.map((trigger) => `  - ${trigger}`).join("\n")}
profiles:
  - minimal
targets:
  markdown:
    enabled: true
safety:
  allow_shell_commands: ${safety.allow_shell_commands}
  allow_network: ${safety.allow_network}
  allow_file_writes: ${safety.allow_file_writes}
  includes_scripts: ${safety.includes_scripts}
tags: []
`;
}

async function writeLibrary(
  root: string,
  skills: Array<{
    id: string;
    body?: string;
    triggers?: string[];
    safety?: {
      allow_shell_commands: boolean;
      allow_network: boolean;
      allow_file_writes: boolean;
      includes_scripts: boolean;
    };
    scripts?: boolean;
    assets?: boolean;
  }>
): Promise<void> {
  await mkdir(join(root, "skills"), { recursive: true });
  await mkdir(join(root, "profiles"), { recursive: true });

  for (const skill of skills) {
    await mkdir(join(root, "skills", skill.id), { recursive: true });
    await writeFile(join(root, "skills", skill.id, "skill.yml"), skillYml(skill));
    await writeFile(
      join(root, "skills", skill.id, "body.md"),
      skill.body ?? "# Skill\n\n## Output format\n\nPlain text.\n\n## What not to do\n\nAvoid surprises.\n"
    );

    if (skill.scripts) {
      await mkdir(join(root, "skills", skill.id, "scripts"), { recursive: true });
      await writeFile(join(root, "skills", skill.id, "scripts", "run.sh"), "echo audit\n");
    }

    if (skill.assets) {
      await mkdir(join(root, "skills", skill.id, "assets"), { recursive: true });
      await writeFile(join(root, "skills", skill.id, "assets", "template.txt"), "asset\n");
    }
  }

  await writeFile(
    join(root, "profiles", "minimal.yml"),
    `name: minimal
description: Minimal profile.
skills:
${skills.map((skill) => `  - ${skill.id}`).join("\n")}
`
  );
}

async function warningCodes(root: string): Promise<string[]> {
  const library = await loadLibrary(root);
  const result = await auditLibrary(library);
  return result.warnings.map((warning) => warning.code);
}

describe("auditLibrary", () => {
  it("warns for overlong bodies and missing authoring anchors", async () => {
    const root = await makeTempRoot();
    await writeLibrary(root, [
      {
        id: "large-skill",
        body: Array.from({ length: 501 }, (_, index) => `Line ${index + 1}`).join("\n")
      }
    ]);

    await expect(warningCodes(root)).resolves.toEqual([
      "body-too-long",
      "missing-output-format-anchor",
      "missing-what-not-to-do-anchor"
    ]);
  });

  it("warns for weak triggers", async () => {
    const root = await makeTempRoot();
    await writeLibrary(root, [{ id: "trigger-skill", triggers: ["help", "create detailed handoffs"] }]);

    await expect(warningCodes(root)).resolves.toContain("weak-trigger");
  });

  it("warns for scripts, assets, and safety metadata mismatches", async () => {
    const root = await makeTempRoot();
    await writeLibrary(root, [
      {
        id: "payload-skill",
        scripts: true,
        assets: true,
        safety: {
          allow_shell_commands: false,
          allow_network: false,
          allow_file_writes: false,
          includes_scripts: false
        }
      }
    ]);

    await expect(warningCodes(root)).resolves.toEqual([
      "asset-payload-present",
      "safety-scripts-mismatch",
      "scripts-present"
    ]);
  });

  it("warns when body instructions conflict with safety flags", async () => {
    const root = await makeTempRoot();
    await writeLibrary(root, [
      {
        id: "unsafe-skill",
        body: [
          "# Unsafe",
          "",
          "## Output format",
          "",
          "Run `curl https://example.com` and write the report to disk.",
          "",
          "## What not to do",
          "",
          "Do not skip verification."
        ].join("\n"),
        safety: {
          allow_shell_commands: false,
          allow_network: false,
          allow_file_writes: false,
          includes_scripts: false
        }
      }
    ]);

    await expect(warningCodes(root)).resolves.toEqual([
      "safety-file-writes-mismatch",
      "safety-network-mismatch",
      "safety-shell-mismatch"
    ]);
  });

  it("warns for overlapping triggers across separate skills", async () => {
    const root = await makeTempRoot();
    await writeLibrary(root, [
      { id: "handoff-one", triggers: ["create a detailed handoff", "write transfer notes"] },
      { id: "handoff-two", triggers: ["create detailed handoff", "summarize work for next agent"] }
    ]);

    const library = await loadLibrary(root);
    const result = await auditLibrary(library);

    expect(result.warnings).toEqual([
      {
        code: "overlapping-trigger",
        message: "Skills 'handoff-one' and 'handoff-two' have overlapping activation triggers.",
        skill: "handoff-one",
        relatedSkills: ["handoff-two"]
      }
    ]);
  });
});

import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LoadedSkill } from "../src/core/index.js";
import { renderSkillPayloadFiles } from "../src/core/renderHelpers.js";

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "threadkit-payloads-"));
}

function skill(args: { id: string; dir: string; enabled?: boolean }): LoadedSkill {
  return {
    id: args.id,
    dir: args.dir,
    metadata: {
      id: args.id,
      name: args.id,
      version: "0.1.0",
      status: "draft",
      summary: `Summary for ${args.id}.`,
      category: "testing",
      triggers: [`use ${args.id}`],
      profiles: ["minimal"],
      targets: {
        claude: { enabled: args.enabled ?? true }
      },
      safety: {
        allow_shell_commands: false,
        allow_network: false,
        allow_file_writes: false,
        includes_scripts: false
      },
      tags: []
    },
    body: `# ${args.id}\n`
  };
}

describe("render payload helpers", () => {
  it("recursively discovers regular files under assets and scripts in sorted order", async () => {
    const root = await makeTempRoot();
    const skillDir = join(root, "skills", "payload");
    await mkdir(join(skillDir, "assets", "nested"), { recursive: true });
    await mkdir(join(skillDir, "scripts", "bin"), { recursive: true });
    await writeFile(join(skillDir, "assets", "z.txt"), "asset z\n");
    await writeFile(join(skillDir, "assets", "nested", "a.txt"), "asset a\n");
    await writeFile(join(skillDir, "scripts", "run.sh"), "echo run\n");
    await writeFile(join(skillDir, "scripts", "bin", "setup.sh"), "echo setup\n");

    const files = renderSkillPayloadFiles({
      skills: [skill({ id: "payload", dir: skillDir })],
      targetKey: "claude",
      relPathForPayload: ({ skill, payloadDir, payloadRelPath }) =>
        `claude/skills/${skill.id}/${payloadDir}/${payloadRelPath}`
    });

    expect(files).toEqual([
      {
        relPath: "claude/skills/payload/assets/nested/a.txt",
        copySource: join(skillDir, "assets", "nested", "a.txt"),
        marker: true
      },
      {
        relPath: "claude/skills/payload/assets/z.txt",
        copySource: join(skillDir, "assets", "z.txt"),
        marker: true
      },
      {
        relPath: "claude/skills/payload/scripts/bin/setup.sh",
        copySource: join(skillDir, "scripts", "bin", "setup.sh"),
        marker: true
      },
      {
        relPath: "claude/skills/payload/scripts/run.sh",
        copySource: join(skillDir, "scripts", "run.sh"),
        marker: true
      }
    ]);
  });

  it("ignores missing directories, empty directories, directory-only trees, symlinks, and disabled skills", async () => {
    const root = await makeTempRoot();
    const emptyDir = join(root, "skills", "empty");
    const dirsOnlyDir = join(root, "skills", "dirs-only");
    const symlinkDir = join(root, "skills", "symlink");
    const disabledDir = join(root, "skills", "disabled");
    await mkdir(join(emptyDir, "assets"), { recursive: true });
    await mkdir(join(dirsOnlyDir, "assets", "nested"), { recursive: true });
    await mkdir(join(symlinkDir, "assets"), { recursive: true });
    await mkdir(join(disabledDir, "assets"), { recursive: true });
    await writeFile(join(symlinkDir, "real.txt"), "real\n");
    await symlink(join(symlinkDir, "real.txt"), join(symlinkDir, "assets", "linked.txt"));
    await writeFile(join(disabledDir, "assets", "ignored.txt"), "ignored\n");

    const files = renderSkillPayloadFiles({
      skills: [
        skill({ id: "missing", dir: join(root, "skills", "missing") }),
        skill({ id: "empty", dir: emptyDir }),
        skill({ id: "dirs-only", dir: dirsOnlyDir }),
        skill({ id: "symlink", dir: symlinkDir }),
        skill({ id: "disabled", dir: disabledDir, enabled: false })
      ],
      targetKey: "claude",
      relPathForPayload: ({ skill, payloadDir, payloadRelPath }) =>
        `claude/skills/${skill.id}/${payloadDir}/${payloadRelPath}`
    });

    expect(files).toEqual([]);
  });
});

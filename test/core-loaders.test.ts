import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadLibrary,
  loadProfile,
  loadProfiles,
  loadSkill,
  loadSkills,
  resolveProfile
} from "../src/core/index.js";

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "threadkit-loaders-"));
}

const validSkillYml = `id: handoff
name: Handoff
version: 0.1.0
status: draft
summary: Creates a handoff document.
category: coordination
triggers:
  - create a handoff
  - write a handoff document
profiles:
  - minimal
targets:
  markdown:
    enabled: true
safety:
  allow_shell_commands: false
  allow_network: false
  allow_file_writes: true
  includes_scripts: false
tags: []
`;

const validProfileYml = `name: minimal
description: Smallest useful baseline.
skills:
  - handoff
`;

describe("core skill loaders", () => {
  it("loads skill metadata and body from skills/<id>", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "skills", "handoff"), { recursive: true });
    await writeFile(join(root, "skills", "handoff", "skill.yml"), validSkillYml);
    await writeFile(
      join(root, "skills", "handoff", "body.md"),
      "# Handoff\n\nWrite a handoff document.\n"
    );

    const skill = await loadSkill({ root, id: "handoff" });

    expect(skill).toMatchObject({
      id: "handoff",
      metadata: { id: "handoff", name: "Handoff" },
      body: "# Handoff\n\nWrite a handoff document.\n"
    });
    expect(skill.dir).toBe(join(root, "skills", "handoff"));
  });

  it("rejects a skill when its folder id differs from metadata id", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "skills", "handoff-copy"), { recursive: true });
    await writeFile(join(root, "skills", "handoff-copy", "skill.yml"), validSkillYml);
    await writeFile(join(root, "skills", "handoff-copy", "body.md"), "# Handoff\n");

    await expect(loadSkill({ root, id: "handoff-copy" })).rejects.toThrow(
      "Skill directory 'handoff-copy' does not match skill id 'handoff'."
    );
  });

  it("loads all skill directories in deterministic id order", async () => {
    const root = await makeTempRoot();

    for (const id of ["zeta-skill", "alpha-skill"]) {
      await mkdir(join(root, "skills", id), { recursive: true });
      await writeFile(join(root, "skills", id, "skill.yml"), validSkillYml.replaceAll("handoff", id));
      await writeFile(join(root, "skills", id, "body.md"), `# ${id}\n`);
    }

    await expect(loadSkills(root)).resolves.toMatchObject([
      { id: "alpha-skill" },
      { id: "zeta-skill" }
    ]);
  });
});

describe("core profile loaders", () => {
  it("loads a profile from profiles/<name>.yml", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "profiles"), { recursive: true });
    await writeFile(join(root, "profiles", "minimal.yml"), validProfileYml);

    const profile = await loadProfile({ root, name: "minimal" });

    expect(profile).toMatchObject({
      name: "minimal",
      metadata: { name: "minimal", skills: ["handoff"] }
    });
    expect(profile.file).toBe(join(root, "profiles", "minimal.yml"));
  });

  it("rejects a profile when its filename differs from metadata name", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "profiles"), { recursive: true });
    await writeFile(join(root, "profiles", "other.yml"), validProfileYml);

    await expect(loadProfile({ root, name: "other" })).rejects.toThrow(
      "Profile file 'other.yml' does not match profile name 'minimal'."
    );
  });

  it("loads all profiles in deterministic name order", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "profiles"), { recursive: true });
    await writeFile(join(root, "profiles", "minimal.yml"), validProfileYml);
    await writeFile(
      join(root, "profiles", "coding-heavy.yml"),
      validProfileYml.replace("name: minimal", "name: coding-heavy")
    );

    await expect(loadProfiles(root)).resolves.toMatchObject([
      { name: "coding-heavy" },
      { name: "minimal" }
    ]);
  });
});

describe("profile resolution", () => {
  it("expands profile skill ids to loaded skills in profile order", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "skills", "alpha-skill"), { recursive: true });
    await mkdir(join(root, "skills", "zeta-skill"), { recursive: true });
    await writeFile(
      join(root, "skills", "alpha-skill", "skill.yml"),
      validSkillYml.replaceAll("handoff", "alpha-skill")
    );
    await writeFile(join(root, "skills", "alpha-skill", "body.md"), "# Alpha\n");
    await writeFile(
      join(root, "skills", "zeta-skill", "skill.yml"),
      validSkillYml.replaceAll("handoff", "zeta-skill")
    );
    await writeFile(join(root, "skills", "zeta-skill", "body.md"), "# Zeta\n");

    const profile = {
      name: "minimal",
      file: join(root, "profiles", "minimal.yml"),
      metadata: {
        name: "minimal",
        description: "Smallest useful baseline.",
        skills: ["zeta-skill", "alpha-skill"]
      }
    };
    const skills = await loadSkills(root);

    expect(resolveProfile({ profile, skills }).skills.map((skill) => skill.id)).toEqual([
      "zeta-skill",
      "alpha-skill"
    ]);
  });

  it("rejects profile references to missing skills", () => {
    const profile = {
      name: "minimal",
      file: "/tmp/profiles/minimal.yml",
      metadata: {
        name: "minimal",
        description: "Smallest useful baseline.",
        skills: ["missing-skill"]
      }
    };

    expect(() => resolveProfile({ profile, skills: [] })).toThrow(
      "Profile 'minimal' references missing skill 'missing-skill'."
    );
  });
});

describe("library loading", () => {
  it("loads the complete canonical library from a root", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "skills", "handoff"), { recursive: true });
    await mkdir(join(root, "profiles"), { recursive: true });
    await writeFile(join(root, "skills", "handoff", "skill.yml"), validSkillYml);
    await writeFile(join(root, "skills", "handoff", "body.md"), "# Handoff\n");
    await writeFile(join(root, "profiles", "minimal.yml"), validProfileYml);

    await expect(loadLibrary(root)).resolves.toMatchObject({
      root,
      skills: [{ id: "handoff" }],
      profiles: [{ name: "minimal" }]
    });
  });

  it("loads and resolves the repository canonical library", async () => {
    const library = await loadLibrary(process.cwd());
    const minimal = library.profiles.find((profile) => profile.name === "minimal");

    expect(library.skills.map((skill) => skill.id)).toContain("handoff");
    expect(minimal).toBeDefined();
    expect(resolveProfile({ profile: minimal!, skills: library.skills }).skills.map((skill) => skill.id)).toEqual([
      "handoff"
    ]);
  });
});

# Core Data Loaders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Slice 3 by loading canonical skills and profiles from disk, validating their schema shape, and resolving profile skill references.

**Architecture:** Add a small `src/core/` boundary that owns filesystem reads and cross-file consistency checks. Schema modules stay pure Zod validators; renderers, target path resolution, write plans, and CLI commands remain out of scope for this slice.

**Tech Stack:** TypeScript ESM, `node:fs/promises`, `node:path`, `yaml.parse`, existing Zod schemas, Vitest.

---

## Slice 3 Acceptance Criteria

- Reads `skills/<id>/skill.yml` and `skills/<id>/body.md`.
- Rejects a skill whose folder name does not match `skill.yml` `id`.
- Loads `profiles/<name>.yml`.
- Rejects a profile whose filename does not match its internal `name`.
- Resolves each profile skill id to a loaded canonical skill.
- Rejects missing profile skill references.
- Preserves profile skill ordering in the resolved output.
- Keeps the implementation tests-first and passes PR checks: `check`, `test`, and `build`.

## Proposed API

```ts
export interface LoadedSkill {
  id: string;
  dir: string;
  metadata: Skill;
  body: string;
}

export interface LoadedProfile {
  name: string;
  file: string;
  metadata: Profile;
}

export interface LoadedLibrary {
  root: string;
  skills: LoadedSkill[];
  profiles: LoadedProfile[];
}

export interface ResolvedProfile {
  profile: LoadedProfile;
  skills: LoadedSkill[];
}

export async function loadSkill(args: { root: string; id: string }): Promise<LoadedSkill>;
export async function loadSkills(root: string): Promise<LoadedSkill[]>;
export async function loadProfile(args: { root: string; name: string }): Promise<LoadedProfile>;
export async function loadProfiles(root: string): Promise<LoadedProfile[]>;
export async function loadLibrary(root: string): Promise<LoadedLibrary>;
export function resolveProfile(args: {
  profile: LoadedProfile;
  skills: LoadedSkill[];
}): ResolvedProfile;
```

Errors can start as normal `Error` instances with stable, specific messages. Do not build a larger error taxonomy until the CLI JSON validation slice needs structured output codes.

## Task 1: Add Canonical Profile Files

**Files:**
- Create: `profiles/minimal.yml`
- Create: `profiles/coding-heavy.yml`

**Step 1: Write the failing test**

Add to `test/canonical-skills.test.ts`:

```ts
import { profileSchema } from "../src/schema/index.js";

it("includes schema-valid baseline profiles for the current canonical library", async () => {
  for (const name of ["minimal", "coding-heavy"]) {
    const profilePath = join(process.cwd(), "profiles", `${name}.yml`);
    const profile = parse(await readFile(profilePath, "utf8"));

    expect(profileSchema.parse(profile)).toMatchObject({
      name,
      skills: ["handoff"]
    });
  }
});
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- test/canonical-skills.test.ts`

Expected: FAIL because `profiles/minimal.yml` does not exist.

**Step 3: Create minimal profile files**

`profiles/minimal.yml`:

```yaml
name: minimal
description: Smallest useful baseline for any local AI coding CLI environment.
skills:
  - handoff
```

`profiles/coding-heavy.yml`:

```yaml
name: coding-heavy
description: Coding-focused baseline for local AI coding CLI environments.
skills:
  - handoff
```

**Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- test/canonical-skills.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add profiles/minimal.yml profiles/coding-heavy.yml test/canonical-skills.test.ts
git commit -m "test: add baseline canonical profiles"
```

## Task 2: Implement `loadSkill`

**Files:**
- Create: `src/core/loadSkill.ts`
- Create: `src/core/index.ts`
- Test: `test/core-loaders.test.ts`

**Step 1: Write the failing tests**

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadSkill } from "../src/core/index.js";

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

describe("core skill loaders", () => {
  it("loads skill metadata and body from skills/<id>", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "skills", "handoff"), { recursive: true });
    await writeFile(join(root, "skills", "handoff", "skill.yml"), validSkillYml);
    await writeFile(join(root, "skills", "handoff", "body.md"), "# Handoff\n\nWrite a handoff document.\n");

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
});
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: FAIL because `../src/core/index.js` does not exist.

**Step 3: Write minimal implementation**

`src/core/loadSkill.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { skillSchema, type Skill } from "../schema/index.js";

export interface LoadedSkill {
  id: string;
  dir: string;
  metadata: Skill;
  body: string;
}

export async function loadSkill(args: { root: string; id: string }): Promise<LoadedSkill> {
  const dir = join(args.root, "skills", args.id);
  const metadata = skillSchema.parse(parse(await readFile(join(dir, "skill.yml"), "utf8")));

  if (metadata.id !== args.id) {
    throw new Error(`Skill directory '${args.id}' does not match skill id '${metadata.id}'.`);
  }

  return {
    id: metadata.id,
    dir,
    metadata,
    body: await readFile(join(dir, "body.md"), "utf8")
  };
}
```

`src/core/index.ts`:

```ts
export * from "./loadSkill.js";
```

**Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/loadSkill.ts src/core/index.ts test/core-loaders.test.ts
git commit -m "feat: load canonical skills from disk"
```

## Task 3: Implement `loadSkills`

**Files:**
- Modify: `src/core/loadSkill.ts`
- Test: `test/core-loaders.test.ts`

**Step 1: Write the failing test**

```ts
import { loadSkill, loadSkills } from "../src/core/index.js";

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
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: FAIL because `loadSkills` is not exported.

**Step 3: Write minimal implementation**

Use `readdir(join(root, "skills"), { withFileTypes: true })`, filter directories, sort by `name`, and call `loadSkill({ root, id: entry.name })`.

**Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/loadSkill.ts test/core-loaders.test.ts
git commit -m "feat: load canonical skill set"
```

## Task 4: Implement Profile Loaders

**Files:**
- Create: `src/core/loadProfiles.ts`
- Modify: `src/core/index.ts`
- Test: `test/core-loaders.test.ts`

**Step 1: Write the failing tests**

```ts
import { loadProfile, loadProfiles } from "../src/core/index.js";

const validProfileYml = `name: minimal
description: Smallest useful baseline.
skills:
  - handoff
`;

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
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: FAIL because profile loader exports do not exist.

**Step 3: Write minimal implementation**

`loadProfile` should read `profiles/<name>.yml`, `yaml.parse` it, validate with `profileSchema`, and enforce `${metadata.name}.yml === ${name}.yml`.

`loadProfiles` should read `profiles/`, filter `.yml` files, sort by basename, and call `loadProfile`.

**Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/loadProfiles.ts src/core/index.ts test/core-loaders.test.ts
git commit -m "feat: load canonical profiles from disk"
```

## Task 5: Implement `resolveProfile`

**Files:**
- Create: `src/core/resolveProfile.ts`
- Modify: `src/core/index.ts`
- Test: `test/core-loaders.test.ts`

**Step 1: Write the failing tests**

```ts
import { resolveProfile } from "../src/core/index.js";

describe("profile resolution", () => {
  it("expands profile skill ids to loaded skills in profile order", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "skills", "alpha-skill"), { recursive: true });
    await mkdir(join(root, "skills", "zeta-skill"), { recursive: true });
    await writeFile(join(root, "skills", "alpha-skill", "skill.yml"), validSkillYml.replaceAll("handoff", "alpha-skill"));
    await writeFile(join(root, "skills", "alpha-skill", "body.md"), "# Alpha\n");
    await writeFile(join(root, "skills", "zeta-skill", "skill.yml"), validSkillYml.replaceAll("handoff", "zeta-skill"));
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

  it("rejects profile references to missing skills", async () => {
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
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: FAIL because `resolveProfile` is not exported.

**Step 3: Write minimal implementation**

Build a `Map<string, LoadedSkill>`, iterate `profile.metadata.skills`, and throw on the first missing id. Return `{ profile, skills }` with resolved skills ordered exactly like the profile file.

**Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/resolveProfile.ts src/core/index.ts test/core-loaders.test.ts
git commit -m "feat: resolve profile skill references"
```

## Task 6: Implement `loadLibrary`

**Files:**
- Create: `src/core/loadLibrary.ts`
- Modify: `src/core/index.ts`
- Test: `test/core-loaders.test.ts`

**Step 1: Write the failing test**

```ts
import { loadLibrary } from "../src/core/index.js";

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
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: FAIL because `loadLibrary` is not exported.

**Step 3: Write minimal implementation**

Call `loadSkills(root)` and `loadProfiles(root)`. For each profile, call `resolveProfile({ profile, skills })` to force missing-reference validation during library load. Return `{ root, skills, profiles }`.

**Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/loadLibrary.ts src/core/index.ts test/core-loaders.test.ts
git commit -m "feat: load canonical library from disk"
```

## Task 7: Add Real Library Integration Coverage

**Files:**
- Test: `test/core-loaders.test.ts`

**Step 1: Write the failing or confirming integration test**

```ts
it("loads and resolves the repository canonical library", async () => {
  const library = await loadLibrary(process.cwd());
  const minimal = library.profiles.find((profile) => profile.name === "minimal");

  expect(library.skills.map((skill) => skill.id)).toContain("handoff");
  expect(minimal).toBeDefined();
  expect(resolveProfile({ profile: minimal!, skills: library.skills }).skills.map((skill) => skill.id)).toEqual([
    "handoff"
  ]);
});
```

**Step 2: Run test**

Run: `corepack pnpm test -- test/core-loaders.test.ts`

Expected: PASS if earlier tasks added profile files correctly. If it fails, fix only the loader behavior or canonical profile data that caused the failure.

**Step 3: Commit**

```bash
git add test/core-loaders.test.ts
git commit -m "test: cover canonical library loading"
```

## Task 8: Full Verification

**Files:**
- No production edits unless verification exposes a bug.

**Step 1: Run type check**

Run: `corepack pnpm check`

Expected: PASS.

**Step 2: Run tests**

Run: `corepack pnpm test`

Expected: PASS.

**Step 3: Run build**

Run: `corepack pnpm build`

Expected: PASS.

**Step 4: Inspect git diff**

Run: `git status --short` and `git diff --stat`

Expected: only Slice 3 loader, profile, and test files changed.

**Step 5: Open PR**

```bash
git push -u origin feat/core-loader
gh pr create --draft --title "Add core data loaders" --body "Implements Slice 3 core data loaders for canonical skills and profiles."
```

Then wait for required GitHub checks: `Full validation` and CodeQL.

## Out of Scope

- CLI `validate`, `list`, or `show` commands.
- Renderer input contracts beyond types needed by loaders.
- Target maps, path overrides, dist output, write plans, manifests, or installation safety.
- Structured JSON error output.
- Auditing body length, scripts, examples, assets, or quality warnings.

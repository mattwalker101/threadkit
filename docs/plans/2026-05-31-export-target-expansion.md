# Export Target Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add renderer routing plus shared `skill` format exports for `claude` and `antigravity`.

**Architecture:** Keep renderers pure and synchronous. Add a renderer registry keyed by target format, then route `threadkit export <target>` through the target map instead of hard-coding markdown. The new `skill` renderer emits deterministic `SKILL.md` files under each target's dist subdirectory while install safety stays out of scope.

**Tech Stack:** TypeScript, Node 24, commander, yaml, vitest, pnpm.

---

## Task 1: Add Failing Skill Renderer Tests

**Files:**
- Create: `test/export-skill.test.ts`
- Read: `src/core/renderTypes.ts`
- Read: `src/schema/skill.ts`

**Step 1: Write the failing test file**

Create `test/export-skill.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LoadedSkill } from "../src/core/index.js";
import { renderSkill } from "../src/core/renderSkill.js";

function skill(args: {
  id: string;
  name?: string;
  summary?: string;
  body?: string;
  claude?: boolean;
  antigravity?: boolean;
  overrideDescription?: string;
}): LoadedSkill {
  return {
    id: args.id,
    dir: `/root/skills/${args.id}`,
    metadata: {
      id: args.id,
      name: args.name ?? args.id,
      version: "0.1.0",
      status: "draft",
      summary: args.summary ?? `Summary for ${args.id}.`,
      category: "testing",
      triggers: [`use ${args.id}`, `run ${args.id}`],
      profiles: ["minimal"],
      targets: {
        claude: { enabled: args.claude ?? true },
        antigravity: { enabled: args.antigravity ?? true },
        markdown: { enabled: true }
      },
      safety: {
        allow_shell_commands: false,
        allow_network: false,
        allow_file_writes: false,
        includes_scripts: false
      },
      tags: [],
      target_overrides:
        args.overrideDescription === undefined
          ? undefined
          : {
              claude: {
                description: args.overrideDescription
              }
            }
    },
    body: args.body ?? `# ${args.id}\n\nBody for ${args.id}.\n`
  };
}

describe("skill renderer", () => {
  it("renders deterministic SKILL.md files in profile order", () => {
    const input = {
      profile: "minimal",
      target: "claude",
      scope: "user" as const,
      skills: [
        skill({ id: "zeta", summary: "Zeta summary." }),
        skill({ id: "alpha", summary: "Alpha summary." })
      ]
    };

    const first = renderSkill(input);
    const second = renderSkill(input);

    expect(first).toEqual(second);
    expect(first.format).toBe("skill");
    expect(first.warnings).toEqual([]);
    expect(first.files.map((file) => file.relPath)).toEqual([
      "claude/skills/zeta/SKILL.md",
      "claude/skills/alpha/SKILL.md"
    ]);
  });

  it("filters by target flag and writes target-specific markers", () => {
    const result = renderSkill({
      profile: "minimal",
      target: "antigravity",
      scope: "user",
      skills: [
        skill({ id: "enabled", antigravity: true }),
        skill({ id: "disabled", antigravity: false })
      ]
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      relPath: "antigravity/skills/enabled/SKILL.md",
      marker: true
    });
    expect(result.files[0].content).toContain(
      "<!-- threadkit:generated target=antigravity profile=minimal skill=enabled -->"
    );
    expect(result.files[0].content).not.toContain("/root");
    expect(result.files[0].content).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("uses target override descriptions before summary", () => {
    const result = renderSkill({
      profile: "minimal",
      target: "claude",
      scope: "user",
      skills: [
        skill({
          id: "handoff",
          summary: "Summary description.",
          overrideDescription: "Override description."
        })
      ]
    });

    expect(result.files[0].content).toContain("description: Override description.");
    expect(result.files[0].content).not.toContain("description: Summary description.");
  });

  it("places the marker immediately after frontmatter and appends the body", () => {
    const result = renderSkill({
      profile: "minimal",
      target: "claude",
      scope: "user",
      skills: [skill({ id: "handoff", body: "# Handoff\n\nUse this skill.\n" })]
    });

    expect(result.files[0].content).toBe(
      [
        "---",
        "name: handoff",
        "description: Summary for handoff.",
        "---",
        "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->",
        "",
        "# Handoff",
        "",
        "Use this skill.",
        ""
      ].join("\n")
    );
  });

  it("truncates overlong descriptions and emits a warning", () => {
    const longDescription = "a".repeat(1025);
    const result = renderSkill({
      profile: "minimal",
      target: "claude",
      scope: "user",
      skills: [skill({ id: "verbose", overrideDescription: longDescription })]
    });

    const descriptionLine = result.files[0].content?.split("\n")[2];

    expect(descriptionLine).toBe(`description: ${"a".repeat(1021)}...`);
    expect(result.warnings).toEqual([
      "Skill 'verbose' description for target 'claude' exceeded 1024 characters and was truncated."
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/export-skill.test.ts
```

Expected: FAIL because `src/core/renderSkill.ts` does not exist.

**Step 3: Commit**

Do not commit yet. Keep this red test for Task 2.

## Task 2: Implement Pure Skill Renderer

**Files:**
- Create: `src/core/renderSkill.ts`
- Modify: `src/core/index.ts`
- Test: `test/export-skill.test.ts`

**Step 1: Add renderer implementation**

Create `src/core/renderSkill.ts`:

```ts
import { stringify } from "yaml";
import type { RenderInput, RenderResult, Renderer } from "./renderTypes.js";

const DESCRIPTION_LIMIT = 1024;
const DESCRIPTION_TRUNCATE_AT = 1021;

function descriptionForSkill(skill: RenderInput["skills"][number], target: string): { description: string; warning?: string } {
  const override = skill.metadata.target_overrides?.[target as keyof typeof skill.metadata.target_overrides]?.description;
  const description = override ?? skill.metadata.summary;

  if (description.length <= DESCRIPTION_LIMIT) {
    return { description };
  }

  return {
    description: `${description.slice(0, DESCRIPTION_TRUNCATE_AT)}...`,
    warning: `Skill '${skill.id}' description for target '${target}' exceeded 1024 characters and was truncated.`
  };
}

function renderSkillFile(input: RenderInput, skill: RenderInput["skills"][number]): { content: string; warning?: string } {
  const { description, warning } = descriptionForSkill(skill, input.target);
  const frontmatter = stringify(
    {
      name: skill.id,
      description
    },
    { sortMapEntries: true }
  ).trimEnd();
  const marker = `<!-- threadkit:generated target=${input.target} profile=${input.profile} skill=${skill.id} -->`;
  const body = skill.body.trimEnd();
  const content = [`---`, frontmatter, `---`, marker, "", body, ""].join("\n");

  return { content, warning };
}

export function renderSkill(input: RenderInput): RenderResult {
  const files = [];
  const warnings: string[] = [];

  for (const skill of input.skills) {
    const enabled = skill.metadata.targets[input.target as keyof typeof skill.metadata.targets]?.enabled === true;

    if (!enabled) {
      continue;
    }

    const result = renderSkillFile(input, skill);

    if (result.warning !== undefined) {
      warnings.push(result.warning);
    }

    files.push({
      relPath: `${input.target}/skills/${skill.id}/SKILL.md`,
      content: result.content,
      marker: true
    });
  }

  return {
    format: "skill",
    files,
    warnings
  };
}

export const skillRenderer: Renderer = {
  render: renderSkill
};
```

**Step 2: Export it from the core barrel**

Modify `src/core/index.ts`:

```ts
export * from "./renderSkill.js";
```

**Step 3: Run the focused test**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/export-skill.test.ts
```

Expected: PASS.

**Step 4: Run typecheck**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
```

Expected: PASS. If TypeScript rejects indexing `target_overrides` or `targets` by `string`, add a small local target-key helper using the existing known target union rather than loosening types globally.

**Step 5: Commit**

```bash
git add src/core/renderSkill.ts src/core/index.ts test/export-skill.test.ts
git commit -m "feat: add skill renderer"
```

## Task 3: Add Renderer Registry and Route Exports by Format

**Files:**
- Create: `src/core/renderers.ts`
- Modify: `src/core/index.ts`
- Modify: `src/cli/commands.ts`
- Test: `test/cli.test.ts`

**Step 1: Add a failing CLI regression test for markdown routing**

In `test/cli.test.ts`, keep the existing markdown export tests unchanged. Add one JSON assertion to the existing successful markdown JSON test:

```ts
expect(output.files[0].relPath).toBe("markdown/minimal.md");
```

If the current test uses `JSON.parse(harness.stdout)` inline, assign it first:

```ts
const output = JSON.parse(harness.stdout);
expect(output).toEqual({
  ok: true,
  root,
  target: "markdown",
  profile: "minimal",
  outDir: out,
  files: [
    {
      path: join(out, "markdown", "minimal.md"),
      relPath: "markdown/minimal.md",
      marker: true,
      bytes: expect.any(Number)
    }
  ],
  warnings: []
});
```

This should already pass, but it protects routing while refactoring.

**Step 2: Create renderer registry**

Create `src/core/renderers.ts`:

```ts
import { markdownRenderer } from "./renderMarkdown.js";
import { skillRenderer } from "./renderSkill.js";
import type { Renderer } from "./renderTypes.js";

export const renderers = {
  markdown: markdownRenderer,
  skill: skillRenderer
} as const satisfies Record<string, Renderer>;

export type RendererFormat = keyof typeof renderers;

export function getRenderer(format: string): Renderer | undefined {
  return renderers[format as RendererFormat];
}
```

**Step 3: Export the registry**

Modify `src/core/index.ts`:

```ts
export * from "./renderers.js";
```

**Step 4: Route `runExport()` through the registry**

Modify imports in `src/cli/commands.ts`:

```ts
import {
  getExportTarget,
  getRenderer,
  loadLibrary,
  resolveProfile,
  writeExportFiles,
  type LoadedSkill
} from "../core/index.js";
```

Replace:

```ts
const result = markdownRenderer.render({
```

with:

```ts
const renderer = getRenderer(target.format);

if (!renderer) {
  throw new CliUsageError("unsupported-format", `Export format '${target.format}' is not supported.`);
}

const result = renderer.render({
```

Keep the input fields the same, especially:

```ts
target: target.name,
```

**Step 5: Run CLI tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/core/renderers.ts src/core/index.ts src/cli/commands.ts test/cli.test.ts
git commit -m "feat: route exports by renderer format"
```

## Task 4: Add Claude and Antigravity Target Map Coverage

**Files:**
- Modify: `src/core/exportTargets.ts`
- Test: `test/cli.test.ts`

**Step 1: Write failing CLI tests for both targets**

In `test/cli.test.ts`, update `validSkillYml` so the fixture declares both targets:

```yaml
targets:
  claude:
    enabled: true
  antigravity:
    enabled: true
  markdown:
    enabled: true
```

Add tests:

```ts
it("exports claude skills to the default dist directory", async () => {
  const root = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const harness = makeHarness();

  await harness.program.parseAsync(["node", "threadkit", "export", "claude", "--profile", "minimal", "--root", root]);

  const output = await readFile(join(root, "dist", "claude", "skills", "handoff", "SKILL.md"), "utf8");
  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  expect(output).toContain("name: handoff");
  expect(output).toContain("description: Creates a handoff document.");
  expect(output).toContain("<!-- threadkit:generated target=claude profile=minimal skill=handoff -->");
  expect(output).toContain("# Handoff");
});

it("exports antigravity skills to a custom output directory as JSON", async () => {
  const root = await makeTempRoot();
  const out = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const harness = makeHarness();

  await harness.program.parseAsync([
    "node",
    "threadkit",
    "export",
    "antigravity",
    "--profile",
    "minimal",
    "--root",
    root,
    "--out",
    out,
    "--format",
    "json"
  ]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  expect(await readFile(join(out, "antigravity", "skills", "handoff", "SKILL.md"), "utf8")).toContain(
    "<!-- threadkit:generated target=antigravity profile=minimal skill=handoff -->"
  );
  expect(JSON.parse(harness.stdout)).toEqual({
    ok: true,
    root,
    target: "antigravity",
    profile: "minimal",
    outDir: out,
    files: [
      {
        path: join(out, "antigravity", "skills", "handoff", "SKILL.md"),
        relPath: "antigravity/skills/handoff/SKILL.md",
        marker: true,
        bytes: expect.any(Number)
      }
    ],
    warnings: []
  });
});
```

Update the unsupported-target test to use a name that remains unsupported after this slice, such as `unknown-target`.

**Step 2: Run tests to verify they fail**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: FAIL because `claude` and `antigravity` are not in `exportTargets`.

**Step 3: Expand the target map**

Modify `src/core/exportTargets.ts`:

```ts
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
```

If TypeScript reports that `paths` is not part of `ExportTarget`, add it:

```ts
paths?: {
  user?: string;
  project?: string;
};
```

**Step 4: Run CLI tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/exportTargets.ts test/cli.test.ts
git commit -m "feat: add claude and antigravity export targets"
```

## Task 5: Update Project Status

**Files:**
- Modify: `PROJECT_STATUS.md`

**Step 1: Update status text**

Change the current status to reflect this slice once implementation and verification pass:

```md
## Current Slice

Slice 7 complete: Export Target Expansion.

Next slice: continue renderer coverage beyond the shared `skill` format, likely
the Codex `agents-md` renderer and target.

## Current Goal

Build additional pure renderers on top of the expanded target routing boundary.

Slice 7 added renderer routing by target format and shared `skill` exports for
`claude` and `antigravity`. Exports remain staged-only under `dist/` or `--out`;
install safety, manifests, backups, pruning, and foreign-file detection remain
out of scope.
```

Keep the Local Environment section intact.

**Step 2: Commit**

```bash
git add PROJECT_STATUS.md
git commit -m "docs: update project status for export targets"
```

## Task 6: Full Verification

**Files:**
- No edits expected.

**Step 1: Run full tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
```

Expected: PASS.

**Step 2: Run typecheck**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
```

Expected: PASS.

**Step 3: Run build**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm build
```

Expected: PASS.

**Step 4: Check worktree**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on the implementation branch, with local commits for the slice.

## Notes

- Do not add install or uninstall behavior in this slice.
- Do not add marker scanning or foreign-file safety in this slice.
- Do not copy assets or scripts in this slice.
- Keep all renderers synchronous and filesystem-free.
- Keep output deterministic: no timestamps, usernames, absolute source paths, or platform-specific line endings.

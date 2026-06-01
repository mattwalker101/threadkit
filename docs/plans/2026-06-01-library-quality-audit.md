# Library Quality Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `threadkit audit` with deterministic quality warnings and `--strict` exit-code behavior.

**Architecture:** Keep validation and audit separate. `loadLibrary` continues to own structural correctness; a new core `auditLibrary` module consumes a valid library and produces structured warnings. CLI code formats the result and maps `--strict` to exit code `1` when warnings exist.

**Tech Stack:** TypeScript, Node 24 fs/promises, Commander, Vitest.

---

### Task 1: Core Audit Tests

**Files:**
- Create: `test/audit-library.test.ts`
- Later create: `src/core/auditLibrary.ts`
- Later modify: `src/core/index.ts`

**Step 1: Write failing tests**

Add tests that build temporary valid libraries and assert warning codes for:

- Body longer than 500 lines.
- Missing `## Output format` and `## What not to do` anchors.
- Weak triggers.
- Scripts/assets payloads and `includes_scripts` mismatch.
- Body text indicating shell/network/file writes while safety flags are false.
- Overlapping triggers across two skills.

**Step 2: Run red test**

Run: `source ~/.nvm/nvm.sh && nvm use && corepack pnpm test test/audit-library.test.ts`

Expected: fail because `auditLibrary` does not exist.

**Step 3: Implement minimal core**

Create `src/core/auditLibrary.ts` exporting:

```ts
export interface AuditWarning {
  code: string;
  message: string;
  skill?: string;
  relatedSkills?: string[];
}

export interface AuditResult {
  warnings: AuditWarning[];
}

export async function auditLibrary(library: LoadedLibrary): Promise<AuditResult>;
```

Add deterministic warning sorting by skill id, code, message.

**Step 4: Run green test**

Run: `source ~/.nvm/nvm.sh && nvm use && corepack pnpm test test/audit-library.test.ts`

Expected: pass.

### Task 2: CLI Audit Tests

**Files:**
- Modify: `test/cli.test.ts`
- Later modify: `src/cli/commands.ts`
- Later modify: `src/cli/index.ts`

**Step 1: Write failing tests**

Add tests for:

- `threadkit audit --root <root> --format json` returns `{ ok: true, root, warnings: [...] }` and exits `0` when warnings exist.
- `threadkit audit --root <root> --strict --format json` exits `1` with the same warning objects.
- `threadkit audit --root <invalid> --format json` exits `1` with `errors` and empty `warnings`.
- Clean audit text output reports `Library audit passed: <root>`.

**Step 2: Run red test**

Run: `source ~/.nvm/nvm.sh && nvm use && corepack pnpm test test/cli.test.ts`

Expected: fail because the command is not registered.

**Step 3: Implement CLI**

Add `AuditOptions extends RootOptions { strict?: boolean }`, `runAudit`, and Commander registration.

**Step 4: Run green test**

Run: `source ~/.nvm/nvm.sh && nvm use && corepack pnpm test test/cli.test.ts`

Expected: pass.

### Task 3: Full Verification

**Files:**
- All modified source and tests.

**Step 1: Run full tests**

Run: `source ~/.nvm/nvm.sh && nvm use && corepack pnpm test`

Expected: all tests pass.

**Step 2: Run type check**

Run: `source ~/.nvm/nvm.sh && nvm use && corepack pnpm check`

Expected: no TypeScript errors.

**Step 3: Run build**

Run: `source ~/.nvm/nvm.sh && nvm use && corepack pnpm build`

Expected: build exits `0`.

**Step 4: Inspect diff**

Run: `git status --short && git diff --stat`

Expected: only audit slice files are changed.

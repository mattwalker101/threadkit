# Lifecycle Operations Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move install lifecycle orchestration out of `src/cli/commands.ts` into a reusable core operation module without changing CLI behavior.

**Architecture:** Add `src/core/lifecycleOperations.ts` as the sequencing layer between CLI adapters and existing core plan/apply helpers. CLI command handlers keep option parsing, formatting, exit-code policy, and emission. Existing plan/apply modules keep filesystem safety and mutation behavior.

**Tech Stack:** TypeScript, Vitest, Commander, Node fs/path APIs, pnpm.

---

### Task 1: Add Operation Boundary Tests

**Files:**
- Create: `test/lifecycle-operations.test.ts`
- Modify: `src/core/index.ts`

**Step 1: Write failing tests**

Add tests for:

- install dry-run returns `{ kind: "dry-run" }` with a `WritePlan`;
- install apply returns `{ kind: "applied" }` with an apply result;
- backup prune dry-run returns `{ kind: "dry-run" }` with a prune plan;
- backup prune apply returns `{ kind: "applied" }` and deletes old generations.

**Step 2: Run tests to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/lifecycle-operations.test.ts
```

Expected: fail because `src/core/lifecycleOperations.ts` does not exist.

### Task 2: Implement Lifecycle Operation Module

**Files:**
- Create: `src/core/lifecycleOperations.ts`
- Modify: `src/core/index.ts`

**Step 1: Implement minimal operations**

Use existing helpers from `src/core/index.ts` modules:

- install: load library, resolve profile, render, build install plan, apply when requested and no foreign-file block exists;
- uninstall: resolve install base dir, load manifest, build uninstall plan, apply when requested;
- rollback: resolve install base dir, load latest manifest or named backup generation, build rollback plan, apply when requested;
- backup list: resolve install base dir, load backup index, return matching generations;
- backup prune: resolve install base dir, load backup index, build prune plan, apply when requested.

**Step 2: Export the module**

Add `export * from "./lifecycleOperations.js";` to `src/core/index.ts`.

**Step 3: Run focused tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/lifecycle-operations.test.ts
```

Expected: pass.

### Task 3: Thin CLI Lifecycle Handlers

**Files:**
- Modify: `src/cli/commands.ts`
- Test: `test/cli.test.ts`

**Step 1: Replace orchestration inline code**

Update `runInstall`, `runUninstall`, `runRollback`, `runBackupList`, and
`runBackupPrune` to call the operation helpers. Keep formatting and exit-code
behavior identical.

**Step 2: Run CLI tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: pass with no output shape changes.

### Task 4: Update Project Status And Verify

**Files:**
- Modify: `PROJECT_STATUS.md`

**Step 1: Update status**

Replace the deferred lifecycle extraction known gap with a note that lifecycle
orchestration has a core operation boundary.

**Step 2: Run final verification**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
```

Expected: TypeScript check passes and all tests pass.

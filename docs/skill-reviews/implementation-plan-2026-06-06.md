# Implementation Plan Skill Review

## Review Metadata

- Skill: `implementation-plan`
- Date: 2026-06-06
- Reviewer: Codex
- Candidate status: `draft`
- Target status: `beta`
- Test project: `/Users/matt/Workspace/active/threadkit`
- Test scenario: Convert the rough ThreadKit feature request
  `target-render-smoke` from `docs/skill-readiness.md` into an implementation
  plan.
- Install targets considered: `claude`, `antigravity`, `codex`, `opencode`,
  `gemini`

## Source Review

The skill has a clear planning outcome: turn rough goals, issues, bug reports,
or product specs into an agent-ready implementation plan. The triggers are
specific to planning and do not materially overlap with adjacent skills:
`build-handoff` and `handoff` create continuation artifacts, while
`skill-readiness-review` evaluates skill promotion evidence.

Initial source gaps found:

- Safety metadata had `allow_shell_commands: false`, but the procedure requires
  inspecting repository structure, patterns, tests, and nearby implementation
  seams. That normally requires read-only shell commands.
- The output contract grouped out-of-scope work under `Scope`, but the trial
  prompt explicitly asked for non-goals. A separate `Non-goals` section makes
  the contract easier to test.
- The procedure did not say what to do when required context, files, or tools
  are unavailable. That can lead agents to hide gaps behind plausible plans.

Readiness checklist notes:

- Metadata is coherent for beta: stable lowercase id, distinct name,
  outcome-oriented summary, expected profiles, and intentional target
  enablement.
- Activation is specific enough for beta. `make this agent-ready` is the
  broadest trigger, but still maps to converting rough work into an executable
  plan.
- The procedure starts with objective and scope, then requires local inspection
  before proposing files or tests.
- Safety does not include network or scripts, and the skill does not require
  destructive actions.

## Validation And Audit

Commands run from `/Users/matt/Workspace/active/threadkit` before edits:

```bash
node dist/cli/index.js validate --format json
node dist/cli/index.js audit --strict --format json
node dist/cli/index.js show implementation-plan
node dist/cli/index.js show implementation-plan --format json
```

Results:

- Validation: pass, no warnings.
- Strict audit: pass, no warnings.
- `show implementation-plan`: loaded content matched source.
- `show implementation-plan --format json`: reported `status: draft` and
  `allow_shell_commands: false` before the safety metadata edit.

## Render Smoke

Commands run:

```bash
rm -rf /tmp/threadkit-skill-review
mkdir -p /tmp/threadkit-skill-review
for profile in minimal coding-heavy; do
  for target in markdown claude antigravity codex opencode gemini; do
    node dist/cli/index.js export "$target" \
      --profile "$profile" \
      --out "/tmp/threadkit-skill-review/$profile"
  done
done
```

Results:

- `implementation-plan` rendered for `claude`, `antigravity`, `codex`,
  `opencode`, and `markdown` in both `minimal` and `coding-heavy`.
- `gemini` produced no files, expected because the skill disables Gemini.
- Claude render:
  `claude/skills/implementation-plan/SKILL.md` includes frontmatter, managed
  marker, and complete body.
- Antigravity render:
  `antigravity/skills/implementation-plan/SKILL.md` includes frontmatter,
  managed marker, and complete body.
- Codex aggregate render: `codex/AGENTS.md` includes the Implementation Plan
  section and reads coherently before Build Handoff.
- OpenCode render: `opencode/command/implementation-plan.md` uses the expected
  command file name and includes the complete body.
- Markdown aggregate render: `markdown/minimal.md` includes the summary,
  triggers, and complete body.

## Install Dry Run

Project path used for dry-runs:
`/Users/matt/Workspace/active/threadkit`.

Commands used `--scope project --profile minimal --format json`. No `--apply`
command was run.

Results:

- `claude`: pass. Planned seven managed files under `.claude/skills/...`; no
  warnings.
- `antigravity`: pass. Planned seven managed files under `.agents/skills/...`;
  no warnings.
- `opencode`: pass. Planned seven managed command files under
  `.opencode/command/...`; no warnings.
- `gemini`: pass with zero files, expected because Gemini is disabled.
- `codex`: safely blocked with exit 1 because the repository already has a
  foreign `AGENTS.md`. Planned path was project-root `AGENTS.md` with action
  `skip-foreign`, preserving managed-file safety.

## Real Task Trial

Prompt:

```text
Use the implementation-plan skill. Turn this rough ThreadKit feature request into an implementation plan with files, tests, assumptions, and explicit non-goals:

Add `target-render-smoke`: exports one profile across enabled targets and checks rendered files for obvious target-specific issues.
```

Repository context inspected:

- CLI command wiring in `src/cli/index.ts` and `src/cli/commands.ts`.
- Export target definitions in `src/core/exportTargets.ts`.
- Export writer and safe path behavior in `src/core/writeExportFiles.ts`.
- Existing CLI and renderer tests in `test/cli.test.ts`,
  `test/export-skill.test.ts`, `test/export-markdown.test.ts`,
  `test/export-agents-md.test.ts`, `test/export-opencode.test.ts`, and
  `test/render-payloads.test.ts`.
- Existing readiness guidance in `docs/skill-readiness.md` and
  `docs/skill-review-workflow.md`.

Trial plan shape produced:

- Objective: add a `target-render-smoke` capability that exports one selected
  profile across enabled targets and reports obvious render issues by target.
- Scope: CLI-accessible smoke check, target/profile resolution, scratch output
  handling, deterministic issue report, and tests for enabled/disabled target
  behavior.
- Non-goals: no project install/apply behavior, no semantic quality audit of
  skill prose, no network checks, no automatic promotion decisions, and no
  replacement for strict audit.
- Assumptions: it should reuse existing profile resolution, target registry,
  renderers, and safe output writing; it should likely default to a temporary
  directory unless the user supplies an output path.
- Current system notes: `export` already exercises one target/profile at a
  time; tests use temp roots and harnessed Commander programs; Gemini can
  legitimately render zero files when disabled by metadata.
- Implementation slices:
  1. Add core smoke-check types and orchestration near `src/core`.
  2. Add target-specific heuristics for expected files, generated markers,
     empty disabled-target output, and aggregate file presence.
  3. Add CLI command wiring in `src/cli/index.ts` and `src/cli/commands.ts`.
  4. Add text/JSON formatting in `src/cli/output.ts`.
  5. Add focused unit and CLI tests covering success, disabled targets, and a
     deliberately malformed render output.
  6. Document the command in README or readiness workflow after behavior
     settles.
- Verification commands: `corepack pnpm check`, `corepack pnpm test`,
  `corepack pnpm build`, and focused CLI smoke invocations against `minimal`.
- Open decisions: command name and UX (`target-render-smoke` subcommand versus
  `smoke render-targets`), whether scratch outputs are kept by default, and
  exact severity levels for detected issues.

Trial assessment:

- Starts by inspecting repo structure and existing CLI/test patterns: pass.
- Names realistic files/modules without inventing APIs: pass.
- Separates scope, non-goals, assumptions, implementation slices, tests, and
  risks: pass after adding explicit `Non-goals` guidance.
- Identifies decisions needing confirmation: pass.
- Stays in planning mode and does not implement code: pass.

## Findings

1. Safety metadata needed correction from `allow_shell_commands: false` to
   `true`, because useful implementation plans require repository inspection.
2. The output contract should explicitly require `Non-goals` so agents do not
   bury out-of-scope items in prose.
3. Blocker and incomplete-information behavior should be explicit, matching the
   hardening added during the `code-review` readiness pass.
4. Codex project install dry-run is safely blocked by this repository's existing
   foreign `AGENTS.md`; this is not specific to `implementation-plan`.

## Required Edits

Made:

- Promoted `skills/implementation-plan/skill.yml` from `draft` to `beta`.
- Changed `allow_shell_commands` from `false` to `true`.
- Added explicit non-goal handling to the procedure and output sections.
- Added blocker/incomplete-information behavior to the procedure, output
  contract, and "What Not To Do" section.

## Promotion Decision

Promote to `beta`.

Rationale: validation and strict audit passed, enabled targets rendered
coherently, project install dry-runs preserved managed-file safety, and the
real task trial produced a useful implementation plan without writing code. The
observed contract and safety gaps were fixed before promotion.

## Readiness Score

- Activation was correct: pass
- Procedure was followed without extra prompting: pass
- Output format was useful and consistent: pass after explicit `Non-goals` and
  blocker guidance edits
- Safety behavior was correct: pass after metadata edit
- Target rendering looked good: pass
- Real task result was useful: pass

Decision:

- Promote to beta.

## Verification After Edits

Commands run from `/Users/matt/Workspace/active/threadkit`:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
source ~/.nvm/nvm.sh && nvm use && corepack pnpm build
node dist/cli/index.js validate
node dist/cli/index.js audit --strict
rm -rf /tmp/threadkit-skill-review-after
mkdir -p /tmp/threadkit-skill-review-after
for target in markdown claude antigravity codex opencode gemini; do
  node dist/cli/index.js export "$target" \
    --profile minimal \
    --out /tmp/threadkit-skill-review-after
done
```

Results:

- Typecheck passed.
- Vitest passed: 15 test files, 230 tests.
- Build passed.
- Validate passed.
- Strict audit passed.
- Post-edit render smoke exported Markdown, Claude, Antigravity, Codex,
  OpenCode, and Gemini for `minimal`.
- The updated `Non-goals` and blocker/incomplete-information guidance appeared
  in all enabled rendered targets: Claude, Antigravity, Codex, OpenCode, and
  Markdown. Gemini produced no files, expected because the skill disables
  Gemini.

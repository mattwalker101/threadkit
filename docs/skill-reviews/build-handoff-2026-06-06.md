# Build Handoff Skill Review

## Review Metadata

- Skill: `build-handoff`
- Date: 2026-06-06
- Reviewer: Codex
- Candidate status: `draft`
- Target status: `beta`
- Test project: `/Users/matt/Workspace/active/threadkit`
- Test scenario: Create an implementation-oriented handoff from the
  just-finished `implementation-plan` readiness PR #40 and current ThreadKit
  branch state.
- Install targets considered: `claude`, `antigravity`, `codex`, `opencode`,
  `gemini`

## Source Review

The skill has a clear coordination outcome: produce an implementation-oriented
continuation brief from repository state, plan progress, branch or PR context,
tests, blockers, and next actions. It is distinct from the simpler `handoff`
skill, which compacts conversation context into a temporary session-transfer
document. `build-handoff` is repository-state driven and belongs in both
`minimal` and `coding-heavy`.

Initial source gaps found:

- Safety metadata had `allow_network: false`, but the procedure includes related
  issue or PR references. In normal GitHub-hosted work, inspecting PR details
  requires network access through `gh`.
- The procedure captured blockers and assumptions, but did not explicitly say
  what to do when branch, PR, issue, or test context is unavailable.
- The output contract did not name a dedicated references section, even though
  the procedure correctly tells agents to reference paths, commits, issues, or
  PRs instead of copying large content.

Readiness checklist notes:

- Metadata is coherent for beta: stable lowercase id, distinct name,
  outcome-oriented summary, expected profiles, and intentional target
  enablement.
- Activation is specific enough for beta. The broadest trigger,
  `continue this build later`, still maps to implementation continuity rather
  than general session handoff.
- Adjacent-skill overlap is acceptable: `handoff` is for conversation/session
  transfer, while `build-handoff` requires repository and branch context.
- Safety requires shell commands and network access, but no scripts. File writes
  are allowed because the skill may save a handoff where requested.

## Validation And Audit

Commands run from `/Users/matt/Workspace/active/threadkit` before edits:

```bash
node dist/cli/index.js validate --format json
node dist/cli/index.js audit --strict --format json
node dist/cli/index.js show build-handoff
node dist/cli/index.js show build-handoff --format json
```

Results:

- Validation: pass, no warnings.
- Strict audit: pass, no warnings.
- `show build-handoff`: loaded content matched source.
- `show build-handoff --format json`: reported `status: draft` and
  `allow_network: false` before the safety metadata edit.

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

- `build-handoff` rendered for `claude`, `antigravity`, `codex`, `opencode`,
  and `markdown` in both `minimal` and `coding-heavy`.
- `gemini` produced no files, expected because the skill disables Gemini.
- Claude render: `claude/skills/build-handoff/SKILL.md` includes frontmatter,
  managed marker, and complete body.
- Antigravity render: `antigravity/skills/build-handoff/SKILL.md` includes
  frontmatter, managed marker, and complete body.
- Codex aggregate render: `codex/AGENTS.md` includes the Build Handoff section
  and reads coherently before Code Review.
- OpenCode render: `opencode/command/build-handoff.md` uses the expected
  command file name and includes the complete body.
- Markdown aggregate render: `markdown/minimal.md` includes summary, triggers,
  and complete body.

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
Use the build-handoff skill. Create an implementation handoff for the just-finished ThreadKit implementation-plan readiness PR #40 and current repository branch state. Include branch state, PR context, tests run, blockers, and recommended next actions.
```

Repository and PR context inspected:

- `git status -sb`: current branch was `review/build-handoff-readiness` with no
  local file changes at the start of the trial.
- `git log --oneline --decorate -5`: current branch pointed at `dc29a28`, the
  squash merge for PR #40, with recent readiness and lifecycle commits visible.
- `git show --stat --oneline dc29a28`: PR #40 changed three files:
  `docs/skill-reviews/implementation-plan-2026-06-06.md`,
  `skills/implementation-plan/body.md`, and
  `skills/implementation-plan/skill.yml`.
- `gh pr view 40 --json ...`: PR #40 was merged on 2026-06-06 with merge commit
  `dc29a2852daf9cd4af89a5c50232512e3208fb30`, base `main`, head
  `review/implementation-plan-readiness`, and URL
  `https://github.com/mattwalker101/threadkit/pull/40`.
- `docs/skill-reviews/implementation-plan-2026-06-06.md`: review notes recorded
  validation, strict audit, render smoke, install dry-runs, real task trial,
  required edits, and post-edit verification.
- `package.json`: verification commands are `corepack pnpm check`,
  `corepack pnpm test`, and `corepack pnpm build`.

Trial handoff shape produced:

- Objective: continue ThreadKit skill readiness work after PR #40 promoted
  `implementation-plan` to beta.
- Repo state: clean `review/build-handoff-readiness` branch, based on merged
  `main` at `dc29a28`.
- Important references: PR #40 URL, merge commit, review notes path, changed
  skill files, and verification command list.
- Completed work: implementation-plan review evidence recorded, beta metadata
  applied, shell-command safety fixed, non-goals and blocker guidance added,
  all requested verification passed.
- Pending work: run the next readiness review for `build-handoff`, record
  evidence in `docs/skill-reviews/build-handoff-2026-06-06.md`, evaluate network
  metadata, run render/install dry-runs, and promote only if evidence supports
  it.
- Verification: listed the commands from PR #40 and noted that the current
  build-handoff review had not yet run its post-edit verification at trial time.
- Blockers and risks: no active blockers; Codex project install remains
  protected by foreign `AGENTS.md`; network is required for PR context.
- Recommended next steps: complete build-handoff edits, run full verification,
  publish the review PR, then continue with `handoff`.

Trial assessment:

- Captures branch state and PR context: pass.
- Names files, commits, PR URL, and review notes instead of copying full
  artifacts: pass.
- Separates completed work, pending work, verification, blockers, and next
  actions: pass.
- Does not claim current tests pass without fresh output: pass.
- Exposes unavailable or not-yet-run verification instead of hiding it: pass
  after adding explicit unavailable-context guidance.

## Findings

1. Safety metadata needed correction from `allow_network: false` to `true`,
   because PR or issue context often requires GitHub lookup.
2. The procedure should explicitly report unavailable branch, PR, issue, or test
   context and explain how that limits the handoff.
3. The output contract benefits from an `Important references` section so PRs,
   commits, paths, and docs are easy for the next agent to scan.
4. Codex project install dry-run is safely blocked by this repository's existing
   foreign `AGENTS.md`; this is not specific to `build-handoff`.

## Required Edits

Made:

- Promoted `skills/build-handoff/skill.yml` from `draft` to `beta`.
- Changed `allow_network` from `false` to `true`.
- Added procedure guidance for unavailable branch, PR, issue, or test context.
- Added `Important references` to the output contract.

## Promotion Decision

Promote to `beta`.

Rationale: validation and strict audit passed, enabled targets rendered
coherently, project install dry-runs preserved managed-file safety, and the
real task trial produced a useful implementation handoff from live branch and
PR context. The observed safety and output-contract gaps were fixed before
promotion.

## Readiness Score

- Activation was correct: pass
- Procedure was followed without extra prompting: pass
- Output format was useful and consistent: pass after adding `Important
  references`
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
- The updated `Important references` and unavailable-context guidance appeared
  in all enabled rendered targets: Claude, Antigravity, Codex, OpenCode, and
  Markdown. Gemini produced no files, expected because the skill disables
  Gemini.

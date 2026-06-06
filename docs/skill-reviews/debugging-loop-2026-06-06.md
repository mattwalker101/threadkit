# debugging-loop Skill Review

## Review Metadata

- Skill: `debugging-loop`
- Date: 2026-06-06
- Reviewer: Codex
- Candidate status: `draft`
- Target status: `beta`
- Test project: `/Users/matt/Workspace/labs/bolt-voice-prompter`
- Test scenario: Real-project failing-test or reproducible-bug trial in a Swift package.
- Install targets considered: `claude`, `antigravity`, `codex`, `opencode`, `gemini`

## Source Review

The skill has a clear debugging outcome and specific trigger phrases for bugs,
failing tests, broken behavior, and investigations. The procedure encodes a
disciplined sequence: reproduce, capture observed/expected behavior, minimize,
hypothesize, instrument, fix, add regression coverage, and verify.

Initial source gaps to validate during the real trial:

- The procedure does not explicitly say to stop and report root cause before
  patching when the user asks for diagnosis-only behavior.
- The output format is concise, but it does not require progress updates during
  long reproductions.
- Safety flags match the procedure: shell commands and file writes are needed,
  network is not part of the skill.

Readiness checklist notes:

- Metadata is coherent for beta: stable lowercase id, distinct name, outcome
  summary, expected profiles, and target enablement.
- Activation is mostly specific. `something is broken` is broad, but it still
  maps to the debugging job and is balanced by more precise triggers.
- Adjacent-skill overlap is acceptable: `code-review` is about reviewing diffs,
  and `implementation-plan` is about planning, while `debugging-loop` is for
  diagnosing observed failures.
- Procedure starts with the smallest useful context-gathering step and has a
  clear verification end state.
- Main beta risk is output contract precision: the skill says sections are used
  "as relevant", so another agent has latitude. That is acceptable for beta but
  probably too loose for stable.
- The skill does not include destructive actions, external lookup requirements,
  payload files, or target-specific overrides.

## Validation And Audit

Commands run from `/Users/matt/Workspace/active/threadkit`:

```bash
node dist/cli/index.js validate --format json
node dist/cli/index.js audit --strict --format json
node dist/cli/index.js show debugging-loop
node dist/cli/index.js show debugging-loop --format json
```

Results:

- Validation: pass, no warnings.
- Strict audit: pass, no warnings.
- `show debugging-loop`: loaded content matches the source at a high level.

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

- `debugging-loop` rendered for `claude`, `antigravity`, `codex`,
  `opencode`, and `markdown` in both `minimal` and `coding-heavy`.
- `gemini` produced no files, expected because the canonical skills currently
  disable Gemini.
- Focused inspection found the skill body present in each supported target.
- Note: aggregate render targets such as Codex and Markdown concatenate skill
  sections directly; this is acceptable for now, but boundaries rely on
  headings instead of explicit separators.

## Install Dry Run

Dry-runs were executed from `/Users/matt/Workspace/labs/bolt-voice-prompter`
with `--scope project --profile minimal --format json`. No `--apply` command
was run.

Project state before dry-run:

- Branch: `master`
- Dirty files: `AGENTS.md`, `references/antigravity-workspace-template`,
  `whisper.cpp`
- Untracked files: `AGENT_CONTEXT.md`, `README.md`
- The project is outside ThreadKit's writable root, so branch creation, project
  notes, test commands that write build artifacts, and install apply steps need
  explicit approval/escalation.

Dry-run results:

- `claude`: pass, creates seven managed files under
  `.claude/skills/skills/...`; no warnings.
- `antigravity`: pass, creates seven managed files under
  `.agents/skills/skills/...`; no warnings.
- `opencode`: pass, creates seven managed files under
  `.opencode/command/command/...`; no warnings.
- `gemini`: pass with zero files, expected because Gemini is disabled.
- `codex`: fail with `ENOTDIR: not a directory, open
  '/Users/matt/Workspace/labs/bolt-voice-prompter/AGENTS.md/AGENTS.md'`.

The nested `skills/skills` and `command/command` paths match current install
tests, so they may be intentional. The Codex failure appears to be an installer
path-planning issue when the target project already has an `AGENTS.md` file:
`codex.paths.project` is `./AGENTS.md`, but install planning treats it as a
base directory and appends the rendered `codex/AGENTS.md` output.

Future cleanup to track outside this skill promotion:

- Codex project installs need file-target handling or a different configured
  project install base. Current failure: existing project `AGENTS.md` causes the
  installer to attempt `AGENTS.md/AGENTS.md`.
- Install dry-run output for Claude and OpenCode should be revisited for
  ergonomics. It currently plans `.claude/skills/skills/...` and
  `.opencode/command/command/...`, which matches tests but reads as duplicated
  directory naming.
- Add installer coverage for a real project that already has an `AGENTS.md`
  file so the Codex failure is caught before field trials.
- Uninstall lifecycle should clean up its own manifest and empty managed
  directories, or provide a documented command that does so. In the lab trial,
  Claude, Antigravity, and OpenCode uninstall `--apply` deleted all managed
  skill files, but left `.threadkit/install-manifest.json` files and empty
  target directories. A later `--prune-empty-dirs` dry-run reported the skill
  files as `missing` and planned no directory pruning.

## Real Task Trial

Human update on 2026-06-06: continue toward beta with the non-Codex targets and
record Codex for future cleanup.

Suggested activation prompt:

```text
Use the debugging-loop skill. Diagnose this failing Swift package test or
reproducible Bolt bug. Do not patch until you have reproduced it and stated the
root cause.
```

Project trial branch:
`/Users/matt/Workspace/labs/bolt-voice-prompter` on
`threadkit-review-debugging-loop`.

Applied targets:

- `claude`: applied successfully, managed files only, no warnings, no backups.
- `antigravity`: applied successfully, managed files only, no warnings, no
  backups.
- `opencode`: applied successfully, managed files only, no warnings, no
  backups.
- `codex`: not applied because dry-run failed.

Cleanup:

- Claude, Antigravity, and OpenCode uninstall dry-runs planned deletion of all
  managed files with no drift or foreign-file warnings.
- Claude, Antigravity, and OpenCode uninstall `--apply` deleted all managed
  skill files with no warnings.
- Residual cleanup issue: install manifests and empty directories remained after
  uninstall, and a follow-up `--prune-empty-dirs` dry-run planned no pruning
  once the files were already missing.
- Manual cleanup removed the generated `.agents`, `.opencode`, and
  `.claude/skills` directories from the lab project. The pre-existing
  `.claude/settings.local.json` file and `.threadkit-review/debugging-loop.md`
  trial notes remain.

Real task command:

```bash
swift test
```

Observed result:

- The package completed a debug build.
- `swift test` exited 1 with `error: no tests found; create a target in the
  'Tests' directory`.
- A follow-up `swift build` passed, confirming the failure is the absence of a
  SwiftPM test target rather than a compile failure.

Trial assessment:

- Activation was correct: pass.
- Procedure was followed without extra prompting: pass.
- Output format was useful and consistent: pass.
- Safety behavior was correct: pass.
- Target rendering looked good: pass for Claude, Antigravity, OpenCode, and
  Markdown; Codex render looked good but project install failed.
- Real task result was useful: pass.

## Findings

1. Codex project install dry-run fails in a real project that already has
   `AGENTS.md`. This blocks Codex as a real-task trial target until installer
   path handling is fixed or Codex is skipped for this review.
2. The target project's `AGENTS.md` requires jCodemunch for code exploration.
   The project resolved as `local/bolt-voice-prompter`, but it is not indexed
   and this session exposed no `index_folder` tool. A real code-level trial
   should either index the project first or choose a target/session where that
   policy can be followed.
3. The real task trial showed that diagnosis-first stop behavior should be
   explicit in the skill procedure.

## Required Edits

Made:

- Promoted `skills/debugging-loop/skill.yml` from `draft` to `beta`.
- Added a procedure step requiring the agent to stop and report the verified
  cause before patching when the user asks for diagnosis or investigation first.

Potential follow-up edits:

- Consider requiring concise progress updates during long reproductions before
  `stable`.
- Fix or separately track Codex project install path handling.

## Promotion Decision

Promote to `beta`.

Rationale: the skill meets draft requirements, validation/audit passed, enabled
targets rendered coherently, non-Codex project installs applied cleanly, and a
real Swift package failure was reproduced and correctly diagnosed. Codex project
install remains a ThreadKit installer cleanup item rather than a
`debugging-loop` body blocker.

## Verification After Edits

Commands run from `/Users/matt/Workspace/active/threadkit`:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
node dist/cli/index.js validate
node dist/cli/index.js audit --strict
node dist/cli/index.js show debugging-loop
rm -rf /tmp/threadkit-skill-review-after
mkdir -p /tmp/threadkit-skill-review-after
for target in markdown claude antigravity codex opencode gemini; do
  node dist/cli/index.js export "$target" \
    --profile minimal \
    --out /tmp/threadkit-skill-review-after
done
```

Results:

- Typecheck: pass.
- Tests: pass, 15 files and 223 tests.
- Validate: pass.
- Strict audit: pass.
- `show debugging-loop`: includes the diagnosis-first stop step.
- Post-edit export smoke: pass for Markdown, Claude, Antigravity, Codex, and
  OpenCode; Gemini produced no files as expected.
- Focused search confirmed the diagnosis-first stop step appears in all rendered
  supported target outputs.

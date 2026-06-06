# Code Review Skill Review

## Review Metadata

- Skill: `code-review`
- Date: 2026-06-06
- Reviewer: Codex
- Candidate status: `draft`
- Target status: `beta`
- Test project: `/Users/matt/Workspace/labs/bolt-voice-prompter`
- Test scenario: Review the current local diff for correctness bugs,
  regressions, maintainability risks, and missing tests.

## Source Review

- Summary describes the outcome and review priorities clearly.
- Triggers are specific to review requests and do not use generic terms like
  `fix` or `help`.
- Procedure starts with scope discovery, requires surrounding-code inspection,
  and emphasizes correctness, regressions, security, data loss, race
  conditions, and missing tests.
- Output contract correctly requires findings first, ordered by severity, with
  file and line references.
- Safety metadata matches the procedure: shell commands are allowed for reading
  branch state/tests, network is disabled, and file writes are disabled.
- Gap to test in real use: whether the skill reliably avoids rewriting code and
  gives actionable, non-speculative findings.

## Validation And Audit

- `node dist/cli/index.js validate --format json`: pass with no errors or
  warnings.
- `node dist/cli/index.js audit --strict --format json`: pass with no warnings.
- `node dist/cli/index.js show code-review --format json`: loaded source
  matches `skills/code-review/skill.yml` and `skills/code-review/body.md`.

## Render Smoke

- Export smoke completed for `minimal` and `coding-heavy` profiles across
  Markdown, Claude, Antigravity, Codex, OpenCode, and Gemini targets.
- Claude render: `claude/skills/code-review/SKILL.md` includes metadata,
  managed marker, and complete body.
- Antigravity render: `antigravity/skills/code-review/SKILL.md` includes
  metadata, managed marker, and complete body.
- Codex aggregate render: `codex/AGENTS.md` includes the Code Review section and
  reads coherently among adjacent skills.
- OpenCode render: `opencode/command/code-review.md` uses an appropriate command
  file name and includes the complete body.
- Markdown aggregate render: `markdown/minimal.md` includes triggers, summary,
  and body.
- Gemini produced no skill files, as expected because canonical skill metadata
  disables Gemini for this skill.

## Install Dry Run

Project path used for dry-runs:
`/Users/matt/Workspace/labs/bolt-voice-prompter`.

- Claude project dry-run: pass. Planned
  `.claude/skills/code-review/SKILL.md` with action `create`; no duplicated
  path segments and no warnings.
- Antigravity project dry-run: pass. Planned
  `.agents/skills/code-review/SKILL.md` with action `create`; no duplicated path
  segments and no warnings.
- OpenCode project dry-run: pass. Planned
  `.opencode/command/code-review.md` with action `create`; no duplicated path
  segments and no warnings.
- Codex project dry-run: safely blocked with exit 1 because the project already
  has a foreign `AGENTS.md`. Planned path was the project root `AGENTS.md` with
  action `skip-foreign`, confirming the install lifecycle hardening is active.

## Real Task Trial

Prompt:

```text
Use the code-review skill. Review this diff for correctness bugs, regressions,
maintainability risks, and missing tests. Findings first.
```

Observed findings:

1. High: `whisper.cpp/CMakeLists.txt:1` and many related `whisper.cpp` CMake
   files are deleted in the submodule working tree. This would break CMake-based
   builds and examples for the speech engine. Restore the deleted build files or
   explain/remove the submodule if that deletion is intentional.
2. Medium: `references/antigravity-workspace-template/requirements.txt:1` is
   deleted, removing the Python dependency manifest for the template. This can
   break setup for genai/pydantic/MCP tooling. Restore it or replace it with an
   equivalent dependency declaration.
3. Medium: `AGENTS.md:41` requires jCodemunch and forbids terminal fallback, but
   `AGENT_CONTEXT.md:49` says the project is not indexed and instructs terminal
   navigation. Agents receive contradictory exploration policy and may either
   violate project instructions or be unable to inspect code. Align these
   instructions or ensure the repo is indexable and exposes `index_folder`.

The review stayed read-only after installs and did not rewrite code.

## Findings

- The skill activated correctly and produced findings first with severity,
  paths, realistic risks, and remediation.
- The procedure was sufficient for review behavior, but it does not explicitly
  say how to report unavailable required tooling, blockers, or incomplete review
  coverage.
- The real project exposed a jCodemunch tooling mismatch: `resolve_repo` found
  `local/bolt-voice-prompter` but reported it was not indexed, and this session
  did not expose an `index_folder` tool.

## Required Edits

Made:

- Add a procedure/output requirement to report blockers, unavailable tools, or
  incomplete review coverage explicitly after findings.
- Promoted `skills/code-review/skill.yml` from `draft` to `beta`.

## Promotion Decision

Promote to `beta`.

Rationale: validation and strict audit passed, rendered outputs were inspected
for enabled targets, project install dry-runs preserved managed-file safety, and
the real task trial produced actionable findings first without editing code. The
only observed guidance gap was fixed before promotion.

## Readiness Score

- Activation was correct: pass
- Procedure was followed without extra prompting: pass
- Output format was useful and consistent: pass
- Safety behavior was correct: pass
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
```

Results:

- Typecheck passed.
- Vitest passed: 15 test files, 230 tests.
- Build passed.
- Validate passed.
- Strict audit passed.
- Post-edit render smoke exported Markdown, Claude, Antigravity, Codex,
  OpenCode, and Gemini for `minimal`; the new blocker/incomplete-coverage
  guidance appeared in all enabled rendered targets.

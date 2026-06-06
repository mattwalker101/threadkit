# Skill Review Workflow

This workflow turns the readiness checklist into a repeatable review loop for
one skill at a time. It is designed to be mostly automated, with explicit human
checkpoints where judgment matters.

Use this workflow before moving a skill from `draft` to `beta`, or from `beta`
to `stable`.

## Review Outputs

Each review should produce:

- A review branch, such as `review/debugging-loop-readiness`.
- A review notes file, such as
  `docs/skill-reviews/debugging-loop-YYYY-MM-DD.md`.
- Any skill metadata or body edits needed for promotion.
- A promotion decision: keep current status, promote to `beta`, or promote to
  `stable`.

Do not promote a skill by changing `status` alone. Promotion needs evidence.

## Human Checkpoints

The agent can run most setup, validation, exports, installs, prompts, and note
collection. The human should make these decisions:

1. Choose the skill to review.
2. Choose the real project and task scenario.
3. Approve any project-scoped install with `--apply`.
4. Judge whether the skill's behavior was useful in the real task.
5. Approve edits to the skill body, triggers, safety flags, or target support.
6. Decide whether to promote the skill.

## One-Time Local Setup

From the ThreadKit repository:

```bash
cd /Users/matt/Workspace/active/threadkit
source ~/.nvm/nvm.sh
nvm use
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

Use the built CLI during review:

```bash
alias threadkit-local='node /Users/matt/Workspace/active/threadkit/dist/cli/index.js'
threadkit-local --help
```

If aliases are not available in the shell, use the full command:

```bash
node /Users/matt/Workspace/active/threadkit/dist/cli/index.js list
```

## Step 1: Start A Review Branch

Pick one skill:

```bash
SKILL=debugging-loop
```

Create a review branch:

```bash
cd /Users/matt/Workspace/active/threadkit
git status -sb
git switch -c "review/$SKILL-readiness"
```

Create a notes directory:

```bash
mkdir -p docs/skill-reviews
DATE=$(date +%F)
NOTES="docs/skill-reviews/$SKILL-$DATE.md"
```

Create initial notes:

```bash
cat > "$NOTES" <<EOF
# $SKILL Skill Review

## Review Metadata

- Skill: \`$SKILL\`
- Date: $DATE
- Reviewer:
- Candidate status:
- Target status:
- Test project:
- Test scenario:

## Source Review

## Validation And Audit

## Render Smoke

## Install Dry Run

## Real Task Trial

## Findings

## Required Edits

## Promotion Decision

EOF
```

## Step 2: Inspect Source

Read the source files:

```bash
sed -n '1,220p' "skills/$SKILL/skill.yml"
sed -n '1,320p' "skills/$SKILL/body.md"
sed -n '1,260p' docs/skill-readiness.md
```

Record initial source findings in the notes file:

```bash
${EDITOR:-vi} "$NOTES"
```

Review questions:

- Does the summary describe the outcome?
- Are triggers specific and non-overlapping?
- Does the procedure tell an agent exactly what to do?
- Does the output format define required sections and ordering?
- Does `## What Not To Do` block likely failure modes?
- Do safety flags match the procedure?

## Step 3: Validate And Audit

Run repository-level validation:

```bash
threadkit-local validate --format json
threadkit-local audit --strict --format json
```

For human-readable warnings:

```bash
threadkit-local audit --strict
```

Record the result in `## Validation And Audit`.

Warning handling:

- Fix warnings directly related to the reviewed skill.
- Document accepted warnings with a reason.
- Convert unrelated warnings into follow-up issues or later review notes.

## Step 4: Show The Skill

Check how ThreadKit loads the skill:

```bash
threadkit-local show "$SKILL"
threadkit-local show "$SKILL" --format json
```

Record mismatches between source intent and loaded output.

## Step 5: Export Smoke Test

Export every target to a scratch directory:

```bash
rm -rf /tmp/threadkit-skill-review
mkdir -p /tmp/threadkit-skill-review

for profile in minimal coding-heavy; do
  for target in markdown claude antigravity codex opencode gemini; do
    threadkit-local export "$target" \
      --profile "$profile" \
      --out "/tmp/threadkit-skill-review/$profile"
  done
done
```

List rendered files:

```bash
find /tmp/threadkit-skill-review -type f | sort
find /tmp/threadkit-skill-review -type f | grep "$SKILL" || true
```

Inspect the reviewed skill in each relevant target:

```bash
sed -n '1,240p' "/tmp/threadkit-skill-review/minimal/claude/skills/$SKILL/SKILL.md"
sed -n '1,240p' "/tmp/threadkit-skill-review/minimal/antigravity/skills/$SKILL/SKILL.md"
sed -n '1,260p' "/tmp/threadkit-skill-review/minimal/codex/AGENTS.md"
sed -n '1,240p' "/tmp/threadkit-skill-review/minimal/opencode/command/$SKILL.md"
sed -n '1,260p' "/tmp/threadkit-skill-review/minimal/markdown/minimal.md"
```

Gemini is currently disabled for the canonical skills. If a skill enables Gemini
later, inspect the corresponding TOML command file:

```bash
find /tmp/threadkit-skill-review/minimal/gemini -type f -maxdepth 4 | sort
```

Record target-specific problems in `## Render Smoke`.

## Step 6: Choose A Real Project Scenario

Use a real project with a real task. The scenario should naturally activate the
skill under review.

Recommended scenarios:

- `debugging-loop`: a failing test or reproducible bug.
- `code-review`: an existing branch or PR diff.
- `implementation-plan`: a feature request, issue, or rough spec.
- `build-handoff`: an in-progress branch with local or PR context.
- `handoff`: a real session that needs continuation context.
- `skill-capture`: a repeated workflow that should become a reusable skill.

Human checkpoint: choose the project and scenario before installing anything.

## Step 7: Prepare The Test Project

Use a separate branch in the real project:

```bash
cd /path/to/real/project
git status -sb
git switch -c "threadkit-review-$SKILL"
```

If the project needs dependencies or a baseline test command, run them now:

```bash
git status -sb
# Example only. Use the project's real command.
corepack pnpm test
```

Create local review notes in the project:

```bash
mkdir -p .threadkit-review
PROJECT_NOTES=".threadkit-review/$SKILL.md"
cat > "$PROJECT_NOTES" <<EOF
# $SKILL Real Task Trial

## Project

## Scenario

## Baseline State

## Agent Prompt

## Observed Behavior

## Useful Behavior

## Confusing Or Missing Guidance

## Safety Notes

## Recommended Skill Changes

EOF
```

## Step 8: Dry-Run Project Installs

From the test project, dry-run project-scoped installs:

```bash
threadkit-local install claude \
  --root /Users/matt/Workspace/active/threadkit \
  --profile minimal \
  --scope project

threadkit-local install antigravity \
  --root /Users/matt/Workspace/active/threadkit \
  --profile minimal \
  --scope project

threadkit-local install codex \
  --root /Users/matt/Workspace/active/threadkit \
  --profile minimal \
  --scope project

threadkit-local install opencode \
  --root /Users/matt/Workspace/active/threadkit \
  --profile minimal \
  --scope project

threadkit-local install gemini \
  --root /Users/matt/Workspace/active/threadkit \
  --profile minimal \
  --scope project
```

Review the plan output before applying. Foreign files must be inspected before
using `--force`.

Human checkpoint: approve the target or targets to apply.

Apply only the targets needed for the real test. Examples:

```bash
threadkit-local install claude \
  --root /Users/matt/Workspace/active/threadkit \
  --profile minimal \
  --scope project \
  --apply
```

```bash
threadkit-local install opencode \
  --root /Users/matt/Workspace/active/threadkit \
  --profile minimal \
  --scope project \
  --apply
```

```bash
threadkit-local install codex \
  --root /Users/matt/Workspace/active/threadkit \
  --profile minimal \
  --scope project \
  --apply
```

Check installed files:

```bash
git status -sb
find . -maxdepth 4 -type f | grep -E '(\.claude|\.agents|\.opencode|\.gemini|AGENTS.md|threadkit)' | sort
```

## Step 9: Run The Real Task Prompt

Use a prompt that names the skill and defines the expected behavior.

`debugging-loop`:

```text
Use the debugging-loop skill. Diagnose this failing test. Do not patch until you
have reproduced it and stated the root cause.
```

`code-review`:

```text
Use the code-review skill. Review this diff for correctness bugs, regressions,
maintainability risks, and missing tests. Findings first.
```

`implementation-plan`:

```text
Use the implementation-plan skill. Turn this issue into an implementation plan
with files, tests, assumptions, and explicit non-goals.
```

`build-handoff`:

```text
Use the build-handoff skill. Create an implementation handoff from this branch,
current diff, tests, blockers, and next actions.
```

`handoff`:

```text
Use the handoff skill. Compact this session into a continuation brief for a
fresh agent.
```

`skill-capture`:

```text
Use the skill-capture skill. Turn this repeated workflow into a reusable
ThreadKit skill proposal.
```

Record the agent's behavior in the project notes:

```bash
${EDITOR:-vi} "$PROJECT_NOTES"
```

Human checkpoint: judge whether the result was useful enough for the target
status.

## Step 10: Score The Trial

Use this rubric in both the project notes and the repository review notes:

```md
## Readiness Score

- Activation was correct: pass/fail
- Procedure was followed without extra prompting: pass/fail
- Output format was useful and consistent: pass/fail
- Safety behavior was correct: pass/fail
- Target rendering looked good: pass/fail
- Real task result was useful: pass/fail

Decision:

- Keep current status
- Promote to beta
- Promote to stable
```

Recommended thresholds:

- Promote to `beta` only when all six checks pass in one real scenario.
- Promote to `stable` only after three representative successful real scenarios.

## Step 11: Patch The Skill

Back in ThreadKit:

```bash
cd /Users/matt/Workspace/active/threadkit
${EDITOR:-vi} "skills/$SKILL/body.md"
${EDITOR:-vi} "skills/$SKILL/skill.yml"
${EDITOR:-vi} "$NOTES"
```

Common edits:

- Tighten triggers.
- Add missing procedure steps.
- Make output sections explicit.
- Add blocker or refusal behavior.
- Correct safety flags.
- Add target-specific command names or descriptions.
- Leave status unchanged when evidence is insufficient.

Human checkpoint: approve semantic changes and promotion status.

## Step 12: Verify The Skill Edits

Run the full local verification:

```bash
cd /Users/matt/Workspace/active/threadkit
source ~/.nvm/nvm.sh
nvm use
corepack pnpm check
corepack pnpm test
threadkit-local validate
threadkit-local audit --strict
```

Re-run the export smoke:

```bash
rm -rf /tmp/threadkit-skill-review-after
mkdir -p /tmp/threadkit-skill-review-after

for target in markdown claude antigravity codex opencode gemini; do
  threadkit-local export "$target" \
    --profile minimal \
    --out /tmp/threadkit-skill-review-after
done

find /tmp/threadkit-skill-review-after -type f | sort
```

Record verification output in the review notes.

## Step 13: Clean Up The Test Project

Uninstall ThreadKit-managed project files for targets you applied:

```bash
cd /path/to/real/project
threadkit-local uninstall claude --scope project
threadkit-local uninstall claude --scope project --apply
```

Other target examples:

```bash
threadkit-local uninstall opencode --scope project --apply
threadkit-local uninstall codex --scope project --apply
threadkit-local uninstall antigravity --scope project --apply
threadkit-local uninstall gemini --scope project --apply
```

Check the project:

```bash
git status -sb
```

Keep or delete the test branch based on whether the project notes are useful.

## Step 14: Finish The Review Branch

Back in ThreadKit:

```bash
cd /Users/matt/Workspace/active/threadkit
git status -sb
git diff --stat
```

Commit the review:

```bash
git add README.md docs/skill-readiness.md docs/skill-review-workflow.md docs/skill-reviews "skills/$SKILL"
git commit -m "Review $SKILL skill readiness"
```

Push and open a PR when the review is ready:

```bash
git push -u origin "review/$SKILL-readiness"
gh pr create --draft --fill
```

## Automation Design For The Reusable Skill

The reusable `skill-readiness-review` skill guides this workflow with the agent
doing the repetitive work and the human making review decisions.

### Inputs

- Skill id.
- Target status: `beta` or `stable`.
- Test project path.
- Real task scenario.
- Targets to install for the trial.
- Whether the agent may create branches in ThreadKit and the test project.

### Agent Responsibilities

- Read `skill.yml`, `body.md`, and readiness docs.
- Create or update the review notes file.
- Run validate, audit, show, export, and render smoke commands.
- Prepare the test project branch.
- Dry-run project installs.
- Stop for human approval before any install `--apply`.
- Provide the exact prompt for the real task.
- Collect the user's assessment of the trial.
- Draft skill edits based on findings.
- Run verification after edits.
- Summarize promotion evidence and remaining gaps.

### Human Checkpoints

1. Confirm skill id and target status.
2. Confirm test project and scenario.
3. Approve install `--apply`.
4. Run or observe the real task interaction.
5. Score the result.
6. Approve skill edits.
7. Approve promotion status.
8. Approve PR creation.

### Suggested Skill Procedure

1. Load the readiness checklist and current skill source.
2. Create `docs/skill-reviews/<skill-id>-<date>.md`.
3. Run structural commands and append results to the review notes.
4. Export every target and summarize rendered files.
5. Ask the human to confirm the real project and scenario.
6. Create a test branch in the real project.
7. Dry-run installs and ask before applying.
8. Provide the exact real-task prompt and ask the human to run or approve it.
9. Capture human scoring and observed gaps.
10. Patch the skill source if approved.
11. Run verification.
12. Recommend keep, beta, or stable with evidence.

Use this skill before adding too many new canonical skills, because it will make
later skill reviews cheaper and more consistent.

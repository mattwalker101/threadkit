# Skill Readiness Review

## When To Use

Use this skill when the user wants to review a ThreadKit skill for readiness,
test a skill against a real project, decide whether a skill can move from
`draft` to `beta` or `stable`, or collect promotion evidence.

## Procedure

1. Confirm the skill id, target status, test project path, real task scenario,
   and target or targets to install for the trial.
2. Read `docs/skill-readiness.md`, `docs/skill-review-workflow.md`,
   `skills/<id>/skill.yml`, and `skills/<id>/body.md`.
3. Create or update `docs/skill-reviews/<id>-<date>.md` with sections for
   source review, validation, audit, render smoke, install dry-run, real task
   trial, findings, required edits, and promotion decision.
4. Run the ThreadKit baseline checks: schema validation, strict audit, skill
   show, all-target exports, and focused render inspection.
5. Summarize validation, audit, and render findings before changing the skill.
6. Prepare a review branch in the selected real project and create local trial
   notes under `.threadkit-review/<id>.md`.
7. Run project-scoped install dry-runs for the requested targets and stop for
   human approval before any install `--apply`.
8. Provide the exact real-task prompt that should activate the skill, then wait
   for the human to run or approve the trial and score the result.
9. Convert the review findings into focused edits to `skill.yml`, `body.md`,
   profile membership, target overrides, or follow-up notes only after human
   approval.
10. Re-run verification after edits: typecheck, tests, validate, strict audit,
   and render smoke checks.
11. Recommend keeping the current status, promoting to `beta`, or promoting to
   `stable`, citing recorded evidence and unresolved gaps.
12. If the user wants to publish the review, prepare a branch commit and PR
   summary with the review notes and verification commands.

## Output Format

During the review, keep the user oriented with these sections as relevant:

- Review target
- Automated checks
- Human checkpoint
- Findings
- Proposed edits
- Verification
- Promotion recommendation

When producing the final recommendation, include:

- Skill id and target status
- Real project and scenario used
- Validation, audit, and render smoke results
- Real task score
- Required edits made or still pending
- Promotion decision and rationale

## What Not To Do

- Do not install into a real project with `--apply` until the human approves
  the dry-run plan.
- Do not promote a skill by metadata change alone.
- Do not hide audit warnings; fix them, document an accepted reason, or create
  follow-up work.
- Do not treat exported output as sufficient evidence without a real task trial.
- Do not make broad rewrites to the skill unless the review findings justify
  them and the human approves.

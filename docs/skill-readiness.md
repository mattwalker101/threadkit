# Skill Readiness and Status Checklist

ThreadKit skill status is an operating promise. Do not promote a skill by
changing `status` alone; promote it only after the checklist for that status is
true.

Use this document for promotion criteria. Use
[`skill-review-workflow.md`](skill-review-workflow.md) for the repeatable
review procedure and automation plan.

## Status Levels

### Draft

Use `draft` when a skill exists in the library but has not yet been proven in
normal use.

Draft requirements:

- `skill.yml` is schema-valid.
- `body.md` is non-empty and uses the standard sections:
  - `## When To Use`
  - `## Procedure`
  - `## Output Format`
  - `## What Not To Do`
- The skill belongs to at least one profile.
- Safety metadata is intentionally chosen, even if it has not been fully tested.

### Beta

Use `beta` when a skill is ready for routine use, but its wording and activation
boundaries may still change based on field use.

Beta requirements:

- All draft requirements are met.
- `threadkit validate` passes.
- `threadkit audit --strict` passes, or each warning is documented as accepted.
- Triggers are specific enough to avoid accidental activation.
- Triggers do not materially overlap with another enabled skill.
- Safety flags match the procedure and any payload files.
- Rendered output has been inspected for every enabled target.
- The skill has been used successfully on at least one real task.
- Known limitations are captured in the skill body or a follow-up issue.

### Stable

Use `stable` when a skill has a settled contract and can be treated as part of
the canonical kit.

Stable requirements:

- All beta requirements are met.
- The skill has been used successfully on at least three representative tasks.
- The procedure is prescriptive enough that another agent can follow it without
  additional context.
- The output format is precise and includes required fields, ordering, and
  refusal or blocker behavior where relevant.
- The `## What Not To Do` section names the most likely failure modes.
- Rendered output passes smoke checks for the primary targets:
  - Claude
  - Antigravity
  - Codex
  - OpenCode
  - Markdown
- Any enabled target-specific override has been reviewed.
- The skill has tests or canonical assertions that protect its public contract.
- The owner is willing to treat changes as compatibility-sensitive.

## Per-Skill Review Checklist

Use this checklist when moving a skill from `draft` to `beta`, or from `beta` to
`stable`.

### Metadata

- `id` is stable, lowercase, and action-oriented.
- `name` is human-readable and distinct from adjacent skills.
- `summary` describes the outcome, not just the topic.
- `category`, `tags`, `risk`, and `owner` are accurate.
- `profiles` match expected distribution.
- Target enablement is intentional.
- `target_overrides` are present only when the target needs different wording or
  command naming.

### Activation

- Every trigger maps to the skill's actual job.
- No trigger is generic, such as "help", "fix", or "do this".
- Adjacent skills have clearly different triggers.
- Negative examples are understood: prompts that should not activate the skill
  have an obvious better home.

### Procedure

- The procedure starts with the smallest useful context-gathering step.
- It names required inputs and what to do when they are missing.
- It defines when to ask the user versus making a safe assumption.
- It has a clear stopping condition.
- It avoids hidden behavior that would surprise the user.

### Output Contract

- The output format is explicit enough to test.
- Required sections are named.
- Ordering is clear.
- The skill says how to report blockers, uncertainty, or incomplete work.
- The expected tone and level of detail match the skill's purpose.

### Safety

- Shell, network, file-write, and script-payload flags match the actual
  procedure.
- Any destructive action requires confirmation.
- Any external lookup requirement is explicit.
- Payload files in `assets/` or `scripts/` are intentional and documented.

### Rendering and Installability

- Export output is inspected for each enabled target.
- Aggregate targets still read coherently when multiple skills are enabled.
- Command-based targets use good command names.
- Payload paths, if present, are target-appropriate.
- Installable targets preserve ThreadKit's managed-file safety invariant.

### Evidence

- `threadkit validate` result is recorded.
- `threadkit audit --strict` result is recorded.
- Render smoke results are recorded.
- Real-use notes are recorded.
- Open follow-ups are either fixed before promotion or explicitly accepted.

## Recommended Review Order

Review existing skills in this order:

1. `debugging-loop`: high leverage and highest risk because it guides fixes.
2. `code-review`: adjacent to debugging and benefits from a strict finding
   contract.
3. `implementation-plan`: establishes the planning contract used by other work.
4. `build-handoff`: depends on implementation and branch context conventions.
5. `handoff`: simpler than build handoff, but needs a precise continuation
   contract.
6. `skill-capture`: use lessons from the previous five reviews to sharpen the
   skill-authoring process.

## Candidate Skills To Add Next

Prioritize skills that make ThreadKit itself better before expanding into broad
agent workflows.

Recommended next additions:

1. `target-render-smoke`: exports one profile across enabled targets and checks
   rendered files for obvious target-specific issues.
2. `skill-trigger-audit`: compares realistic prompts against the skill set and
   reports ambiguous activation boundaries.
3. `release-prep`: validates, audits, exports, checks install dry-runs, and
   prepares release notes.
4. `docs-sync`: checks README, project status, plans, and skill metadata for
   stale claims after a feature merge.

# Skill Capture

## When To Use

Use this skill when a repeated agent workflow should become a canonical reusable
skill with validated metadata, a clear body, and an appropriate profile mapping.

## Procedure

1. Identify the workflow trigger, intended user request, and concrete outcome the
   skill should produce.
2. Separate durable procedure from project-specific context, transient examples,
   or implementation details that belong elsewhere.
3. Choose a stable lowercase skill id and confirm it matches the target
   directory name.
4. Write `skill.yml` using the current schema, conservative safety flags, useful
   triggers, target support, tags, and profile membership.
5. Write `body.md` with the standard sections: `When To Use`, `Procedure`,
   `Output Format`, and `What Not To Do`.
6. Add assets, scripts, or examples only when they are necessary to execute the
   skill correctly.
7. Validate the skill through the repository's schema tests or equivalent local
   checks.

## Output Format

For a captured skill, produce or update:

- `skills/<id>/skill.yml`
- `skills/<id>/body.md`
- Any required profile references
- Focused tests or validation notes

When summarizing the result, include the skill id, trigger coverage, safety
flags, and verification command.

## What Not To Do

- Do not capture one-off project facts as a general skill.
- Do not use vague triggers that could activate for unrelated tasks.
- Do not enable external access, shell, file writes, scripts, or high-risk behavior
  unless the procedure actually needs them.
- Do not skip schema validation after creating or changing skill files.

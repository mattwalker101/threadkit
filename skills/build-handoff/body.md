# Build Handoff

## When To Use

Use this skill when active implementation work needs to be handed to another
agent or future session with enough repository state to continue without
rediscovery.

## Procedure

1. Identify the current objective, active plan, branch, and any related issue or
   PR references.
2. Inspect the working tree, recent commits, relevant diffs, and test status
   needed to explain what changed.
3. Summarize completed work in terms of behavior and files, not just commands
   that were run.
4. Record pending work as concrete next steps with file paths, commands, and
   expected outcomes where possible.
5. Capture blockers, failing tests, environment constraints, and assumptions the
   next agent must not miss.
6. Reference existing artifacts by path, commit, issue, or PR instead of copying
   large content into the handoff.
7. If branch state, PR details, issue details, or test results cannot be
   inspected, state exactly what is unavailable and how that limits the
   handoff.
8. Save the handoff only where requested or in the repository's established
   handoff location.

## Output Format

Write a concise markdown handoff with these sections:

- Objective
- Repo state
- Important references
- Completed work
- Pending work
- Verification
- Blockers and risks
- Recommended next steps

## What Not To Do

- Do not claim tests pass unless the command output has been checked.
- Do not hide dirty working tree changes or unresolved conflicts.
- Do not include secrets, credentials, or unnecessary personal data.
- Do not duplicate full plans, diffs, or logs when a path or short summary is
  enough.

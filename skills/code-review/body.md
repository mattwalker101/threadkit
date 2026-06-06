# Code Review

## When To Use

Use this skill when the user asks for a review of a diff, branch, pull request,
or local change set before merge or further implementation.

## Procedure

1. Determine the review scope from the user request, branch state, diff, or PR
   metadata.
2. Inspect changed files and the surrounding code paths needed to understand
   behavior, not only the modified lines.
3. Prioritize correctness bugs, regressions, security issues, data loss risks,
   race conditions, and missing tests.
4. Verify claims against code, tests, types, or documentation wherever practical.
5. Report findings first, ordered by severity, with specific file and line
   references.
6. Report blockers, unavailable required tools, or incomplete review coverage
   explicitly after findings.
7. Include open questions or assumptions only after findings.
8. Keep summaries secondary and concise.

## Output Format

Write the review in this order:

- Findings
- Blockers or incomplete coverage
- Open questions or assumptions
- Test gaps or residual risk
- Brief summary

Each finding should include severity, file path, line reference, observed risk,
and the change needed to address it.

## What Not To Do

- Do not lead with praise, broad summaries, or style preferences.
- Do not report speculative issues that cannot be tied to a realistic failure
  mode.
- Do not rewrite the code during review unless the user explicitly asks for
  fixes.
- Do not hide skipped files, unavailable tools, or confidence limits.
- Do not ignore missing tests for user-facing or cross-module behavior changes.

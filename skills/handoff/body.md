# Handoff

## When To Use

Use this skill when the user wants a handoff, session summary, continuation
brief, or context package for another agent or a future session.

## Procedure

1. Write a handoff document summarizing the current conversation so a fresh agent
   can continue the work.
2. Save the document to the temporary directory for the user's operating system,
   not the current workspace.
3. Include a suggested skills section naming the skills the next agent should
   invoke.
4. Reference existing artifacts by path or URL instead of duplicating content
   already captured in PRDs, plans, ADRs, issues, commits, or diffs.
5. Redact sensitive information, including API keys, passwords, credentials, and
   personally identifiable information.
6. If the user passes arguments, treat them as the intended focus for the next
   session and tailor the document accordingly.
7. After saving the handoff, report the exact file path to the user.

## Output Format

Create a concise markdown handoff with these sections:

- Current objective
- Completed work
- Important files, branches, PRs, or URLs
- Pending work
- Suggested skills
- Risks or cautions

## What Not To Do

- Do not save the handoff in the current workspace unless the user explicitly
  asks for that location.
- Do not copy large blocks from existing project artifacts when a path or URL is
  enough.
- Do not include secrets, credentials, or unnecessary personal data.
- Do not invent completed work or hide unresolved blockers.
- Do not turn a session handoff into an implementation-oriented repository
  state handoff; use Build Handoff for branch, PR, diff, and test-state
  continuity.

# Implementation Plan

## When To Use

Use this skill when the user has a rough goal, feature request, bug report,
issue, or product spec and wants it converted into a concrete implementation
plan that another coding agent can execute.

## Procedure

1. Restate the objective in concrete terms and identify the intended user-facing
   outcome.
2. Define scope boundaries, including explicitly out-of-scope work and any
   assumptions that need to hold for the plan to work.
3. Inspect the relevant repository structure, existing patterns, tests, and
   nearby implementation seams before proposing changes.
4. Break the work into ordered slices that each produce a verifiable increment.
5. For each slice, name the expected files or modules, behavioral changes, test
   coverage, and verification command.
6. Call out risks, dependencies, migration concerns, and decisions that require
   user confirmation.
7. If asked to persist the plan, write it as a concise markdown artifact in the
   location requested by the user or the repository's existing planning area.

## Output Format

Write a markdown implementation plan with these sections:

- Objective
- Scope
- Assumptions
- Current system notes
- Implementation slices
- Test plan
- Risks and open questions

## What Not To Do

- Do not invent repository structure, APIs, or test commands when they can be
  inspected locally.
- Do not turn uncertain requirements into hidden assumptions; list them.
- Do not mix unrelated refactors into the plan unless they are necessary for the
  objective.
- Do not write implementation code as part of the planning step unless the user
  explicitly asks for execution.

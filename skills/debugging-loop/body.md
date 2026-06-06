# Debugging Loop

## When To Use

Use this skill when the user reports a bug, failing test, broken behavior,
performance regression, or other unexpected system behavior that requires
diagnosis before changing code.

## Procedure

1. Reproduce the failure with the smallest reliable command or interaction
   available.
2. Capture the exact observed behavior, expected behavior, environment, and
   relevant inputs.
3. Minimize the problem to the narrowest failing test, fixture, route, module, or
   state transition.
4. Form one or more falsifiable hypotheses and inspect the code paths that could
   explain the failure.
5. Add temporary instrumentation or targeted assertions only when they will
   distinguish between hypotheses.
6. If the user asked for diagnosis, root cause, or an investigation before a
   fix, stop and report the verified cause before patching.
7. Implement the smallest fix that addresses the verified cause.
8. Add or update a regression test that fails without the fix.
9. Run the focused verification first, then broader checks appropriate to the
   blast radius.

## Output Format

When reporting progress or results, use these sections as relevant:

- Reproduction
- Root cause
- Fix
- Regression coverage
- Verification
- Remaining risk

## What Not To Do

- Do not guess at a fix before reproducing or narrowing the failure.
- Do not make broad refactors while the root cause is still uncertain.
- Do not remove failing tests or weaken assertions to make the suite pass.
- Do not claim a bug is fixed without running the reproduction or an equivalent
  regression check.

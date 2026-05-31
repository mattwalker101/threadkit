# 0001 Standalone Repository

## Status

Accepted

## Context

Threadkit grew out of Clew planning work, but the v3 implementation plan requires
a deliberately small standalone project.

## Decision

Build Threadkit as its own repository, separate from the paused Clew codebase.

## Consequences

Threadkit may reuse Clew's repository automation patterns, but it does not copy
Clew's implementation or inherit its monorepo structure.

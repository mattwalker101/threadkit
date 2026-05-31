# 0002 Single Package

## Status

Accepted

## Context

Threadkit is a local build-time CLI and has no external package consumer in v1.

## Decision

Use a single TypeScript package with internal module folders. Do not create a
pnpm workspace until a real package boundary is justified.

## Consequences

Build, test, and CI commands stay simple. Internal modules can still be organized
by schema, core, renderers, and CLI.

# Agent Instructions

## Local Node Version

Before running `corepack pnpm ...` commands in this repository, activate the
repo's Node version:

```bash
source ~/.nvm/nvm.sh
nvm use
```

The project is locked to Node 24 through `.nvmrc` and `package.json#engines`,
and CI runs on Node 24.x. If `nvm` is already loaded in the shell, `nvm use` is
enough.

## GitHub Workflow

Prefer `gh` CLI for creating PRs, pushing branches, and checking workflow runs.
The GitHub connector may be used for structured reads, but PR creation can fail
with integration permissions in this repository.

# threadkit

The thread that ties your agentic skills together.

`threadkit` is a file-first, portable skill library and exporter for AI coding CLIs.
It stores, validates, renders, and optionally installs skills. It does not execute
skills or orchestrate agents.

## Development

Use the repository Node version before running pnpm commands. The project is
locked to Node 24 via `.nvmrc` and `package.json#engines`; using newer Node
versions can produce engine warnings and drift from CI.

```bash
source ~/.nvm/nvm.sh
nvm install
nvm use
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm test
```

If your interactive shell already loads nvm, the `source ~/.nvm/nvm.sh` line is
optional. Non-interactive agent shells should include it before `nvm use`.

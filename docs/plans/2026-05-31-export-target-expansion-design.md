# Export Target Expansion Design

## Context

Slice 6 established the export boundary with `threadkit export markdown --profile <name>`.
The markdown renderer is pure and returns `FileSpec[]`; the shared writer owns
filesystem output. The next slice expands this boundary without moving into
install safety, apply plans, manifests, pruning, backups, or foreign-file
detection.

## Approved Scope

Add the first non-markdown format by introducing a shared `skill` renderer and
two targets that use it:

- `claude`
- `antigravity`

The CLI should route rendering by `target.format` rather than hard-coding the
markdown renderer. Export still writes only to `dist/` or `--out`.

## Architecture

Add a renderer registry keyed by format:

- `markdown` uses the existing markdown renderer.
- `skill` uses a new pure skill renderer.

`runExport()` resolves the target with `getExportTarget(targetName)`, looks up
the renderer using `target.format`, and passes the target name through
`RenderInput.target`. This keeps generated markers target-specific while letting
multiple targets share one format renderer.

## Skill Renderer

The `skill` renderer emits one `SKILL.md` file per enabled skill. It preserves
resolved profile order and filters with `skill.metadata.targets[input.target]`.

Relative output paths:

- `claude/skills/<id>/SKILL.md`
- `antigravity/skills/<id>/SKILL.md`

Each file contains deterministic YAML frontmatter:

```yaml
---
name: <id>
description: <description>
---
```

The description is `target_overrides.<target>.description` when present,
otherwise `summary`. If a description exceeds the defensive renderer limit, the
renderer truncates it to 1021 characters plus `...` and emits a warning.

The generated marker is the first body line after frontmatter:

```markdown
<!-- threadkit:generated target=<target> profile=<profile> skill=<id> -->
```

The skill body follows the marker, trimmed to deterministic LF output with one
trailing newline.

## Target Map

Add target entries:

- `claude`: format `skill`, dist subdir `claude`, user path `~/.claude/skills`,
  project path `./.claude/skills`
- `antigravity`: format `skill`, dist subdir `antigravity`, user path
  `~/.gemini/skills`, project path `./.agents/skills`

The path fields are target metadata only in this slice. Export does not install
or inspect those locations.

## Testing

Add focused renderer tests for:

- deterministic output
- target-specific filtering
- profile-order preservation
- marker placement and target/profile/skill fields
- target-specific description override
- defensive description truncation and warning

Extend CLI tests for:

- `threadkit export claude --profile minimal`
- `threadkit export antigravity --profile minimal`
- JSON success envelopes retaining `ok`, `root`, `target`, `profile`, `outDir`,
  `files`, and `warnings`
- existing unsupported-target behavior moving from `codex` to a still-unknown
  target name

## Out Of Scope

- install and uninstall commands
- dry-run write plans
- environment path resolution
- target file safety checks
- marker scanning
- asset or script copying
- Codex, OpenCode, and Gemini renderers

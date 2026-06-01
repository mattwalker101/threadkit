# Library Quality Audit Design

## Goal

Add `threadkit audit` as a quality-oriented inspection command for valid ThreadKit libraries. Audit warnings must help authors improve skills without moving structural failures out of `validate`.

## Recommended Approach

The audit feature should use a pure core result shape plus a small async file probe for optional `scripts/` and `assets/` directories. CLI behavior should remain responsible for JSON/text formatting and exit-code policy.

Two alternatives were considered:

- Put audit checks directly in the CLI. This is faster to write, but makes warning logic harder to unit test and reuse.
- Fold audit warnings into `loadLibrary`. This centralizes loading, but blurs the validation/audit boundary and risks making quality warnings look structural.

The selected design is a separate `auditLibrary(root, library)` core module. It accepts an already-valid loaded library, emits deterministic warning objects, and performs bounded directory existence/file checks for scripts and assets.

## Warning Model

Warnings are structured objects in JSON:

```ts
interface AuditWarning {
  code: string;
  message: string;
  skill?: string;
  relatedSkills?: string[];
}
```

Text output renders one warning per line as `<code>\t<message>`.

Initial warning codes:

- `body-too-long`
- `missing-output-format-anchor`
- `missing-what-not-to-do-anchor`
- `weak-trigger`
- `overlapping-trigger`
- `scripts-present`
- `safety-scripts-mismatch`
- `asset-payload-present`
- `safety-shell-mismatch`
- `safety-network-mismatch`
- `safety-file-writes-mismatch`

## CLI Behavior

`threadkit audit` loads and validates the library first. If validation fails, audit returns the same error envelope style as other commands and exits `1`.

On a valid library:

- No warnings: exit `0`.
- Warnings without `--strict`: exit `0`.
- Warnings with `--strict`: exit `1`.

JSON output should use:

```json
{
  "ok": true,
  "root": "...",
  "warnings": []
}
```

Under `--strict`, warnings do not become `errors`; the exit code carries policy while the envelope preserves that these are audit warnings.

## Checks

Body bloat counts physical body lines and warns above 500 lines. Anchor checks look for level-two markdown headings named `Output format` and `What not to do`, case-insensitively.

Weak triggers are exact normalized matches for low-information phrases such as `help`, `fix`, `do this`, `process`, `use this`, and `run this`.

Overlap detection normalizes triggers, tokenizes alphanumeric words, ignores tiny stop words, and warns when two different skills share either an exact normalized trigger or high token overlap. The initial threshold should stay conservative to avoid noisy reports.

Safety mismatch checks scan body text for shell, network, and file-write intent when the matching safety flag is false. Optional script and asset directory checks warn when those payloads are present, and scripts also warn when `safety.includes_scripts` is false.

## Testing

Use TDD for:

- Core audit warning generation.
- `threadkit audit --format json` envelope behavior.
- `threadkit audit --strict --format json` exit policy.
- Validation failure passthrough.

Run `corepack pnpm test`, `corepack pnpm check`, and `corepack pnpm build` before claiming completion.

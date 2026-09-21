---
description: "DSH host tool package that maps a task's changed files to the quality gates the caller's own config requires, with the raw evidence each gate must return. Reports only; it never blocks an unrun gate."
kind: "package-bundle"
---

# soia-dsh-tool-check-quality-gates

A DSH host tool package: given **the files this task changed**, it returns the quality gates the **caller's config** requires and the raw evidence each gate must paste back.

[中文](README.md)

## What this package does

"Which gates does this change need?" is a judgement that leaks when it lives in memory: source changed but typecheck was skipped, tests were touched but the suite was not run, or docs-only edits drag the whole gate set along. This package moves that judgement into a config file. The caller writes, in `.dsh/gates.yml`, which kind of change needs which gate, what command it runs, and what raw evidence must be pasted back; the tool does one thing — match the changed files against it and return the list.

Three boundaries, up front:

- **Nothing about a project is built in.** Every gate comes from the config; this package's sources, examples, and tests contain no caller command name.
- **It lists gates and stops there.** `enforcement` is always `"none"`, meaning "this tool neither judges whether you ran a gate nor blocks you for skipping one". Blocking belongs to the caller's policy layer.
- **It runs nothing.** No command is executed, no evidence is verified, and git is never touched. The changed-file list is supplied by the caller.

## Install

Not yet on npm; install from the git source (`lib/` is committed, so the installed package works without a local build):

```bash
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-quality-gates'
dsh --profile <profile-name> --dump-config   # configuration layer only; no service is started
```

Once published to npm, the same slot takes the package name: `dsh plugin --profile <profile-name> add soia-dsh-tool-check-quality-gates`.

`cordis.patch.yml` contributes exactly one `insert` row: `id: tool-check-quality-gates`, `name: soia-dsh-tool-check-quality-gates`.

## Tool contract

### `check_quality_gates`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `changedFiles` | string[] | yes | Paths this task changed, relative to the workspace |
| `configPath` | string | no | Config path, resolved against `cwd`. When omitted, the nearest `.dsh/gates.yml` above `cwd` is used |
| `cwd` | string | no | Working directory; defaults to the host process's directory |

### Output schema

The return value always has these six fields, in the same shape for success and failure (on failure `requiredGates` is empty and `error` is set — see the next section):

```json
{
  "changedFiles": ["README.md", "packages/app/src/index.ts"],
  "requiredGates": [
    {
      "id": "typecheck",
      "command": "pnpm run typecheck",
      "reason": "TypeScript sources changed.",
      "rawEvidenceRequired": "Raw exit code plus the first failing diagnostic line."
    }
  ],
  "source": "/workspace/.dsh/gates.yml",
  "enforcement": "none",
  "unmatched": ["README.md"],
  "error": null
}
```

The example output comes from a config that declares the `typecheck` gate only; the value is rendered as JSON text via `JSON.stringify(value, null, 2)`.

| Field | Type | Meaning |
|---|---|---|
| `changedFiles` | string[] | The normalized request: trimmed, `\` folded to `/`, leading `./` removed, deduplicated, sorted |
| `requiredGates` | object[] | Gates at least one changed file selected, **in config-file order**; a gate matched by several files appears once |
| `requiredGates[].id` / `.command` / `.reason` / `.rawEvidenceRequired` | string | Verbatim from the config, so a receipt can quote them as-is |
| `source` | string | Absolute path of the config that was used, or `"<not found>"` |
| `enforcement` | `"none"` | Constant. This tool lists gates and never blocks an unrun gate |
| `unmatched` | string[] | Changed files no gate selected, deduplicated and sorted; **never silently dropped** |
| `error` | string \| null | One readable line when no gate list could be produced; `null` on success |

### Error behavior

A missing, unreadable, or invalid config **never throws and never returns a partial result**: `requiredGates` is empty, every changed file is reported as unmatched, and `error` carries one readable line.

| Situation | `source` | `error` shape |
|---|---|---|
| No config found walking up from `cwd` | `"<not found>"` | `No gate config found: no .dsh/gates.yml in <cwd> or any parent directory.` |
| `configPath` does not exist or is not a regular file | `"<not found>"` | `No gate config found at <path>.` |
| The file exists but cannot be read (permissions, for example) | the path | `Could not read gate config at <path>: <reason>.` |
| YAML syntax or field validation failed | the path | `Invalid gate config at <path>: <reason>.` (syntax failures carry `(line N)`) |

The remaining readable errors (each one English sentence, quotable as-is):

- `config root: expected a mapping` / `config root: unknown key "x" (allowed: gates)`
- `gates[0]: missing required key "command"`
- `gates[0].when.paths: must be a non-empty list of glob strings`
- `gates[0]: unknown key "whenn" (allowed: id, command, reason, rawEvidenceRequired, when)`
- `duplicate gate id "typecheck" (gates[0] and gates[2])`
- `unexpected indentation (line 9)` / `tab characters are not allowed in indentation (line 3)` / `duplicate key "id" (line 2)`

## Config format (`.dsh/gates.yml`)

Lookup rule: an explicit `configPath` wins (resolved against `cwd`); otherwise the search walks up from `cwd` to the filesystem root looking for `.dsh/gates.yml` and takes the **nearest** one, so a closer config wins over one above it.

### Config schema

```yaml
gates:                          # required: the gate list; its order is the returned order
  - id: typecheck               # required: gate id, unique within the file; a duplicate is an error
    command: pnpm run typecheck # required: the command the caller runs (this tool only quotes it back)
    reason: TypeScript sources changed.        # required: why this kind of change needs this gate
    rawEvidenceRequired: Raw exit code plus the first failing diagnostic line.  # required: evidence to paste back
    when:                       # required: the match condition
      paths: ["packages/**/src/**", "src/**"]  # required: non-empty glob list; any match requires the gate
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `gates` | list | yes | The gate list; `gates: []` is valid (no gates), a fully empty file is an error |
| `gates[].id` | string | yes | Non-empty; unique within the file |
| `gates[].command` | string | yes | Non-empty. This package does not parse it, run it, or check that it exists |
| `gates[].reason` | string | yes | Non-empty |
| `gates[].rawEvidenceRequired` | string | yes | Non-empty. This package does not verify that evidence was returned |
| `gates[].when` | mapping | yes | Currently one key |
| `gates[].when.paths` | list\<string\> | yes | Non-empty, non-empty items; matching is described below |

**Unknown keys are always an error** (a `whenn:` typo cannot pass silently). The config has **no built-in defaults**: no built-in gate, no built-in path, no environment-variable switch.

### Glob semantics

Every `when.paths` pattern is a **whole-path-anchored, case-sensitive** glob. Both the path and the pattern are normalized first (`\` → `/`, leading `./` removed, repeated `/` collapsed).

| Form | Meaning |
|---|---|
| `**` | Any run of characters across `/`; `**/` may match zero segments, so `a/**/b` also matches `a/b` |
| `*` | Any run of characters inside one segment; never crosses `/` |
| `?` | Exactly one character inside one segment |
| Anything else | Literal text, regular-expression metacharacters included (`.`, `+`, `(`) |

Unsupported forms: brace expansion, `[abc]` classes, and `!` negation are treated as literal text, so in practice they match no ordinary path; `\` is not an escape either — it is folded to `/` (a Windows separator) before matching. `src/**` does **not** match `src` itself — a directory is not a file; use `src/**` for the files under it.

### Parsed YAML subset

The config is read by the package's own minimal YAML subset parser (**zero runtime dependencies**): block mappings, block sequences, `- key: value` items, flow sequences of scalars (`[a, b]`), single- and double-quoted scalars, comments and blank lines, and one optional `---` line.

Anything outside that subset **fails with a line number instead of being guessed at**: tabs in indentation, anchors/aliases/tags/directives, block scalars (`|`, `>`), flow mappings (`{a: b}`), nested flow collections, multi-line plain scalars, and duplicate keys.

## Design notes

- **Shape**: host tool; no browser half, no client bundle, no `dsh.client` declaration.
- **Layering**: the pure logic lives in `src/host/` — `gates.ts` (parse → match → sort/dedupe → assemble), `glob.ts` (minimal glob), `yaml.ts` (minimal YAML subset) — with the contract types in `src/shared/types.ts`; none of them imports anything from DSH, so another host wrapper (an MCP server, for instance) can reuse them. Only `src/host/config-file.ts` touches the filesystem. `src/index.ts` only registers and wires. Repository layout: [docs/structure.md](../../docs/structure.md).
- **Dependencies**: `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` are peers provided by the host; there is **no runtime dependency**, so the bundle can be packed as-is.
- **Side-effect registration**: the tool registers on the plugin fiber and unregisters when it is disposed. The module holds no host state.
- **What it does not do**: it registers no prompt section (resident model-visible text is zero), no `tools/pre-execute` or `tools/post-execute` policy hook, no event listener; it writes no file and reads no git.
- **Naming**: npm name `soia-dsh-tool-check-quality-gates` (the official `dsh-tool-*` shape with the `soia-` prefix), entry id `tool-check-quality-gates`, tool name `check_quality_gates`.

## Configuration and events

The package reads no configuration of its own (`.dsh/gates.yml` is **call data**, located from the tool arguments and the lookup rule, not plugin configuration) and emits no events.

## License

MIT. See the repository root [`LICENSE`](../../LICENSE).

## Model Experience

### The `check_quality_gates` tool schema

#### What the model sees

The registered tool name `check_quality_gates`, one required string-array parameter `changedFiles`, two optional string parameters `configPath`/`cwd`, and the verbatim description below:

##### Verbatim tool description

```markdown
Map the files changed in a task to the quality gates the caller's config requires, with the raw evidence each gate must return. Report only: enforcement is "none", so an unrun gate is never blocked.
```

The model-facing tool catalog is generated by the host from the registered schema; this repository produces no such catalog, so there is no catalog anchor to cite here.

#### Token effect

Fixed. **Measured: the model-visible projection (the JSON of `name` + `description` + `parameters`) is 578 characters — `name` 19 + `description` 198 + `parameters` 317 — which rounds up to 145 tokens at the host token meter's fixed density (≈4 characters per token). The package registers no prompt section, so its section cost is 0 and `dsh.tokenBudget.resident` is 145 = 145 + 0.** In-package, `tests/host/index.test.ts` recomputes that number from the registered definition and compares it with the manifest (any drift fails); `pnpm run check-token-budget` recomputes it again from the built artifact. The description is deliberately English and two sentences long: it is paid for on every request, while usage detail is available from the parameter schema and failure detail from the `error` field of the result.

#### KV Cache effect

Prefix-stable. The name, the description, and the three parameter schemas are constant strings; this package rewrites no tool block of its own and no existing prefix loses reuse. The prefix changes only when this package's manifest changes those strings, or when another provider changes the tool's visibility or ordering — neither of which this package owns. The tool **result** (the gate list) differs per call, but it is conversation content rather than resident prefix, so it does not affect prefix caching.

### Prompt sections

None. The package registers 0 system-prompt sections: a gate list is an on-demand lookup, not a rule worth paying for every request.

## Known Limitations and Deferred Work

- **The gate list is only as good as the config.** The package does not judge whether the config covers every risk: a directory no `paths` pattern mentions simply shows up in `unmatched`, with no default gate added on its behalf. `unmatched` is a signal, not a gate.
- **It neither runs gates nor verifies evidence.** `command` is never executed, and nothing checks whether the raw evidence really came back or is really raw. `enforcement: "none"` is a constant in the return value; a caller that wants "unrun gate" to block must wire that up in its own policy layer.
- **It reads no git.** `changedFiles` is supplied by the caller: no git invocation, no diff reading, no `.gitignore` awareness. A wrong list yields a gate list that is wrong for the workspace, and the tool has no way to tell.
- **Discovery has no boundary.** The search walks up to the filesystem root, stopping at neither `.git` nor the home directory; in an extreme case it can pick up a `.dsh/gates.yml` outside the repository. Use `configPath` when determinism matters.
- **The glob is a minimal subset.** No brace expansion, character classes, negation, or escaping; matching is case-sensitive and whole-path anchored; directories do not match (`src/**` does not match `src`).
- **The YAML is a minimal subset too.** Anchors, block scalars, flow mappings, nested flow collections, and multi-line plain scalars are rejected with a line number rather than parsed; a config using them must be rewritten in block style. Lenient parsing was deliberately excluded: a config the parser does not understand must fail loudly instead of producing a plausible-looking list with gates missing.
- **The config has no version and no inheritance.** No `schemaVersion`, no `include`/`extends`, no gate groups or dependencies; several workspaces sharing gates must each carry a copy.
- **No config cache and no watch.** Every call re-finds, re-reads, and re-parses the file; on a large repository with frequent calls that is repeated IO (the file is tiny, so the real cost is negligible).
- **The build artifact comes from the root build.** The root `tsdown.config.ts` discovers host entry points from the filesystem (any package with `src/index.ts` is included), so this package needs no root-config edit; `lib/index.js` is produced by the root-side `pnpm run build` and committed with the repository (`pnpm run verify:lib` checks it against the sources). If that file is missing from a working tree, `pnpm run check-token-budget` reports a missing artifact and a git-source install produces a shell with no entry point.
- **Loading and live-call acceptance are not done.** The repository tests cover the core logic (including end-to-end calls against real temporary directories), but there is **no** `--dump-config` smoke run, no `pluginInventory/list` loading evidence, and no real model call yet; per [docs/structure.md](../../docs/structure.md) those three layers each need their own evidence and must be added separately.

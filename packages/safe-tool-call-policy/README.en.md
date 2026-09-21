---
description: "DSH host policy package: matches a tool call against danger patterns before it executes, asking for confirmation or denying with a one-line compliant alternative. Registers no tool and no prompt section."
kind: "package-bundle"
---

# soia-dsh-safe-tool-call-policy

DSH host policy package: inspects a tool call **before it executes**, and on a danger-pattern match either asks for confirmation (`ask`) or denies (`deny`), attaching one sentence on how to do the same thing compliantly.

[中文](README.md)

## What this package does

A model-issued command or file write passes two host hooks before it runs. This package reduces the call to one matchable line, tests it against the danger-pattern list, and then does exactly one of two things:

- **Ask for confirmation** (`ask`): through the `tools/pre-execute` waterfall, so the host's approval channel decides. A deployment with no approval channel degrades to a denial with the registry's own wording, as the official seam specifies.
- **Deny** (`deny`): through `ctx.tools.guard()`. A guard is monotonic and has no allow result, so **no later listener can turn a denial back into permission**.

Both carry the same one-line reason and compliant alternative, readable by the model and actionable by a human.

It registers **no tool and no prompt section**: resident model context is zero tokens (`dsh.tokenBudget.resident: 0`). The only model-visible text it ever produces is the one-line reason inside the result of the call it stopped.

## Install

Not published to npm yet; install from the git source (`lib/` is committed, so the package works right after install):

```bash
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/safe-tool-call-policy'
dsh --profile <profile-name> --dump-config   # verify the config layer only; no server starts
```

Once published to npm, use the package name: `dsh plugin --profile <profile-name> add soia-dsh-safe-tool-call-policy`.

`cordis.patch.yml` contributes one `insert` row: `id: safe-tool-call-policy`, `name: soia-dsh-safe-tool-call-policy`. The package needs no configuration and no environment variable.

## Danger patterns (first version)

The list's single source of truth is [`danger-patterns.json`](danger-patterns.json) at the package root, shipped with the package (it is in the `files` allowlist).

| id | What it catches | Action | Source |
|---|---|---|---|
| `data-root-write` | A write into a real application-data root: a home dot-directory such as `~/.<app>` or `$HOME/.<app>`, or a system data path such as `/etc`, `/var/lib`, `/usr/local`, `/Library`, `/System` | `deny` | `memory:executor-real-home-writes` |
| `secret-in-argv` | A credential literal on the command line: an `Authorization:` header, `--token=` / `--api-key=` / `--password=` forms, a JWT, common token prefixes, `-p<password>` | `deny` | `memory:secret-in-argv` |
| `failure-as-evidence` | An unquoted `--include=*` glob, `ugrep`, or a `2>/dev/null` pipe that discards the first stage's errors | `ask` | `memory:failed-command-not-evidence` |
| `git-danger` | `git stash` / `git checkout` / `git add -A` / a `git commit` without `--only <pathspec>` on a shared checkout | `ask` | `memory:concurrent-git-index` |
| `high-impact-action` | Publishing and wholesale destruction: `npm publish`, an `rm -rf` aimed at a root, home, glob, or parent directory, `git worktree remove --force`, `rsync --delete`, a whole-file redirect over a stylesheet | `ask` | `codex-memory:failures` |
| `destructive-cleanup` | `git worktree remove --force`, or an `rm -rf` whose path contains `worktree` | `ask` | `memory:worktree-cleanup-rule` |

Every rule has exactly the fields `{ id, tool, pattern, action, reason, remedy, source }`: `tool` is `bash` / `write` / `edit` / `*`, `pattern` is a JavaScript regular expression, `reason` and `remedy` are one English sentence each (model-visible), and `source` records the real origin.

**What gets matched**: `bash` matches the command line; `write` / `edit` match `"<tool> <file_path>"` (the tool name supplies the write verb) and **never match file content**; any other tool reduces to an empty text and takes part in no match.

**Precedence**: one call can match several rules (`rm -rf ~/.app` is both a home-data write and a wholesale `rm -rf`). The strictest verdict wins — `deny` over `ask` — and equal verdicts are broken by rule order. The example resolves to `deny` under `data-root-write`.

## Project overrides

A project can **append, override, and disable** rules through `<project root>/.dsh/policy.yml` (or `.dsh/policy.json`). When both files exist, `policy.yml` wins; when neither exists, the built-in list applies. The project root is the session workspace (the process cwd when there is no session).

```yaml
# .dsh/policy.yml
disable:                     # remove by id; applied last, so it always wins
  - failure-as-evidence
rules:
  - id: no-prod-db           # a new id is appended
    tool: bash
    pattern: "psql\\s+-h\\s+prod\\b"
    action: deny
    reason: This command connects to the production database.
    remedy: Use the staging DSN from the environment instead.
    source: project:.dsh/policy.yml
  - id: high-impact-action   # an existing id replaces that rule in place (loosen or reword it)
    tool: bash
    pattern: "\\b(?:npm|pnpm)\\s+publish\\b"
    action: ask
    reason: Publishing is a project-gated action here.
    remedy: Run the release workflow instead of publishing by hand.
  - id: git-danger           # or retire a built-in rule outright
    action: allow
```

Effective order: `rules` first (same id replaces in place, a new id is appended), then `disable` — so `disable` always wins.

`.yml` goes through the package's own **strict subset** reader (block mappings, `- ` block sequences, plain/single-quoted/double-quoted scalars, JSON or bare comma lists, full-line and trailing comments). Block scalars, anchors, aliases, tags, multiple documents, and duplicate keys are refused with an error. Use `.json` when you need full YAML: JSON is a subset of this grammar.

**Every failure mode allows the call**, and every one is written to the host log (`ctx.logger.warn`, prefixed `safe-tool-call-policy:`):

| Situation | Result |
|---|---|
| The project has no policy file | The built-in list applies |
| The project file is unreadable, unparsable, or wrongly shaped at the top level | **No rule applies** (every call is allowed) plus a log line saying why |
| The file parses but one rule is unusable (missing field, unknown action/tool, uncompilable pattern, non-kebab id) | That one rule is dropped with a note; every other rule still applies |
| The shipped pattern set itself is unreadable (broken install) | No rule applies, plus a log line |
| Evaluation throws for any reason | That call is allowed, plus a log line |

Not falling back to the built-in list on a broken config is deliberate: the project may have been loosening or disabling exactly those rules, and falling back would create a failure surface nobody asked for.

## Implementation notes

- **Shape**: a host policy hook in the form of the official `dsh-spill-policy` and `dsh-tool-call-timeout-policy` — it exports `name` / `inject` / `apply`, injects only `tools`, registers no service, no tool, no prompt section, and ships no client bundle.
- **Layering**: the pure matcher is `src/shared/evaluate.ts` (`evaluateCall(call, rules)`, no I/O, no DSH import), types are `src/shared/types.ts`, reason rendering is `src/shared/reason.ts`; the Node side is `src/host/` (call adapter, document parsing, YAML subset, file loading); `src/index.ts` only wires the hooks and resolves the project root. See [docs/structure.md](../../docs/structure.md).
- **Effect-scoped registration**: the `tools/pre-execute` listener and the guard are both registered on the plugin fiber (the guard through `ctx.effect`), so both unregister when the plugin unloads.
- **Dependencies**: `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` are peer-only (mirrored into dev), provided by the host and kept external at build time. The package has no runtime dependency at all — even YAML uses the built-in subset reader — so it stays offline-testable and adds nothing to the lockfile.
- **One disk read per check**: each inspected call reads the built-in list and the project config again, with no cache. Edits take effect immediately; the cost is two small file reads per call.

## Configuration and environment

- **Cordis row config**: none. The package implements no `Config`, so its plugin row needs (and accepts) no options.
- **Environment variables**: none. It reads no `SOIA_*` variable.
- **Project-level config**: `<project root>/.dsh/policy.yml` or `.dsh/policy.json`, in the format above.

## License

MIT. See the repository-root [`LICENSE`](../../LICENSE) for the copyright line.

## Model Experience

### The one-line reason on a stopped call

#### What the model sees

This package adds nothing to the system prompt, the tool table, or any resident context. The only text of its own a model ever reads is one line inside the result of **the call it stopped** (the `reason` of an `ask` decision, or the guard's denial reason). There is exactly one rendering:

##### Verbatim reason line

```markdown
<rule reason> <rule remedy> (safe-tool-call-policy rule: <rule id>)
```

For `git-danger`, that renders as:

```markdown
This git command mutates shared checkout state — stash, checkout, add -A, or a commit that stages whatever is already in the index — so it can pick up another worker's in-progress changes. Do the same operation against explicit paths (git commit --only <pathspec>) or in a separate worktree, and leave the shared index untouched. (safe-tool-call-policy rule: git-danger)
```

A project override supplies its own `reason` / `remedy` and its own `rule id`.

#### Token effect

**Resident cost is 0**: there is no tool schema and no prompt section, `dsh.tokenBudget.resident` declares 0, and `pnpm run check-token-budget` recomputes 0 from the built artifact.

**Per-call cost**: only the stopped call gains this line. Measured across the six shipped rules, the rendered line is 361–480 characters, about 91–120 tokens at the host token meter's fixed density (≈4 characters per token); the longest is `failure-as-evidence` (480 characters ≈ 120 tokens). An allowed call adds no text at all.

#### KV Cache effect

Append-only. This text lands in a **tool result**, not in the system prompt, the tool table, or the runtime-context snapshot, so the reusable request prefix is untouched; different rules producing different text cannot invalidate existing prefix entries. The package itself holds no per-turn context.

## Known Limitations and Deferred Work

- **Matching is a regex heuristic; it does not understand intent.** A string that merely mentions `rm -rf ~/.app` (inside an `echo`, say), or that passes such a path to a command that writes nothing, can still match; conversely, write paths outside the built-in list are missed. A match means "worth a look", not "definitely dangerous".
- **`write` / `edit` match only the target path, never the content.** Writing a script that contains `rm -rf /` is not caught: this package deliberately does not read file content (doing so would flag the very examples inside documentation).
- **Only `bash` / `write` / `edit` are understood.** Other command tools (a PowerShell tool, for instance) and custom tools reduce to an empty text and take part in no match; `tool: "*"` covers only those three.
- **"On a concurrent checkout" is not regex-decidable.** `git-danger` asks on every `git stash` / `git checkout` / `git add -A` / `git commit` without `--only`; `git checkout -b` is explicitly excluded, while `git stash list` is still questioned.
- **"Outside the working directory" is approximated by a fixed list.** The system-path branch of `data-root-write` covers `/etc`, `/var/lib`, `/var/db`, `/usr/local`, `/Library`, and `/System` only; there is no real comparison against the call's cwd (that would mean upgrading rules from pure regex to path-aware predicates).
- **"Visual redesign" is detected only through a bulk-overwrite proxy.** The single signal today is a whole-file redirect over a stylesheet (`> x.css`); changing a design file or adjusting layout produces no signal at all, since judging visual impact is outside what a regex can do.
- **`~/.local/bin` is allowed on purpose**: `install … ~/.local/bin/<tool>` is an ordinary install step. The cost is that other paths under `~/.local` are only caught by the dot-directory shape that follows `.local`.
- **Two disk reads per inspected call.** Neither the built-in list nor the project config is cached, so config edits take effect immediately; a per-project-root cache (and file watching) is not implemented.
- **A broken config allows calls, with the log as the only signal.** There is no channel that pushes "the policy is disabled" to the model or the UI, so an operator only sees the host log; and because every check rereads the files, each one logs a fresh `warn`, so a config left broken keeps logging. Whether to attach a notice to results, or to log once per project root instead, is undecided.
- **YAML is a subset.** The `.yml` reader accepts only the shapes the documentation demonstrates; block scalars, anchors, flow mappings, and multiple documents raise an error (and then the failure semantics above allow the call). Full YAML support would mean taking on a parser dependency, which this version deliberately avoids.
- **Row-level plugin config is not implemented.** A project can only override through `.dsh/policy.yml`, not through rule options on the profile's plugin row; when several projects share one profile, rules resolve per session workspace.
- **`deny` does not short-circuit another plugin's `ask`.** The guard runs after every `tools/pre-execute` listener, so a confirmation another plugin raises first can still reach the user before this package denies the call. The outcome is correct (`deny` wins), but the user may have confirmed for nothing.
- **Loading and real invocation are not yet verified.** This version is backed by unit tests (83 cases) and three focused checks (vitest / oxlint / build:types), but it has **not** been installed into a profile in a real DSH session: there is no `--dump-config` evidence, no `fiberPhase: active` loading evidence, and no real `ask` / `deny` call evidence, and none of it is recorded in [docs/verification.md](../../docs/verification.md).
- **Compatibility is untested.** The `dsh.compatibility.dsh` range `>=0.1.0-rc.8 <0.2.0` is the ecosystem's conventional spelling; under strict node-semver semantics that range does not match prereleases, which is why the peer dependencies list the published prereleases individually. Types and extension points were written against DSH `0.1.6-alpha.2`.

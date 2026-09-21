---
description: "DSH host tool package that audits one session log for whether the required skills were actually loaded, and classifies which kind of failure it was when they were not."
kind: "package-bundle"
---

# soia-dsh-tool-check-skills

A DSH host tool package that reads one session's persisted log and checks whether the **skills a task required were actually loaded** — and when they were not, says which kind of failure it was.

[中文](README.md)

## What this package does

The skill mechanism has one step that is easy to skip. Before the first request the host injects a **skill catalog** (skill name plus a capped description); the model then decides on its own whether to pull the full text in with `skill("<exact name>")`. **There is no retrieval step and no enforcement.** So "the skill is installed in this repository" and "this task really used the skill" are two different facts, and the second one fails silently.

This package reads the session log and answers three questions:

1. Which skills did this session's catalog actually offer?
2. Which of the expected skills were really called?
3. For the ones that were not — was it an assembly problem, a selection problem, or a load that never connected?

It decides only from facts written into the log; it never infers from "this task looks like it should have used that skill".

## Install

Not yet on npm; install from the git source (`lib/` is committed, so the installed package works without a local build):

```bash
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-skills'
dsh --profile <profile-name> --dump-config   # configuration layer only; no service is started
```

Once published to npm, the same slot takes the package name: `dsh plugin --profile <profile-name> add soia-dsh-tool-check-skills`.

`cordis.patch.yml` contributes exactly one `insert` row: `id: tool-check-skills`, `name: soia-dsh-tool-check-skills`.

This package is a read-only audit: it **only reads** session logs and writes nothing under `$DSH_HOME`. The single write is the evidence report, and only when the caller passes `evidenceDir`.

## Tool contract

### `check_skills`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `sessionPath` | string | no | Session log path; defaults to the newest artifact under `$DSH_HOME/sessions` |
| `applicableSkills` | string[] | no | Skill names this task expected; omitting it yields `unreported` |
| `evidenceDir` | string | no | Directory to write the markdown evidence report into |

All three are optional and each omission has a defined answer: the newest session, no verdict, no report.

Success (`status: "ok"`) returns:

```json
{
  "status": "ok",
  "task": { "applicableSkills": ["alpha-protocol"], "source": "argument" },
  "catalog": { "count": 16, "names": ["find-skills", "alpha-protocol"], "present": true, "called": ["alpha-protocol"] },
  "calls": [
    { "name": "alpha-protocol", "turn": 1, "step": 1, "seq": 16, "ok": true, "usedAfterLoad": true }
  ],
  "verdict": "ok",
  "missing": [],
  "sessionPath": "/path/to/session.v3.jsonl.zstd"
}
```

| Field | Meaning |
|---|---|
| `task.applicableSkills` | The normalised expectation list (trimmed, deduplicated, order preserved) |
| `task.source` | `"argument"` when the caller supplied a list, `"none"` otherwise |
| `catalog.count` / `catalog.names` | Skill count and names of the session's **effective** catalog |
| `catalog.present` | Whether the log carries a catalog event at all. `false` means none was published, which is a different fact from a catalog that published zero skills |
| `catalog.called` | Skills this session actually called `skill()` with (deduplicated, in first-call order) |
| `calls[]` | One record per distinct skill called; a skill loaded several times keeps only its **last** attempt, because that attempt's follow-through is what gets judged |
| `calls[].ok` | Whether that attempt really returned skill instructions |
| `calls[].usedAfterLoad` | Whether any **non-`skill`** tool call appears later in the log |
| `verdict` | One of the five verdicts, or `unreported`; with several expectations it is the **worst** one |
| `missing` | Non-`ok` expected skill names, in argument order |

Failure (`status: "error"`) returns `code` and `message`:

| `code` | Meaning |
|---|---|
| `zstd_unsupported` | This Node build has no `zlib.zstdDecompressSync`; reading `.jsonl.zstd` needs Node ≥ 22.15 |
| `session_not_found` | The given path does not exist, or the directory holds no session artifact |
| `sessions_dir_missing` | `$DSH_HOME/sessions` does not exist |
| `sessions_dir_empty` | The session root holds no session artifact |
| `session_unreadable` | The file exists but cannot be read (permissions, for example) |
| `session_empty` | The file is zero bytes |
| `session_decompress_failed` | The bytes are not decodable as zstd |

`verdict` is the **worst per-skill verdict**, ranked (most to least severe): `not_in_catalog` > `wrong_pick` > `not_attempted` > `loaded_not_effective` > `ok`. Assembly problems outrank selection problems, which outrank follow-through problems — because that is the order of the repair work. `unreported` is a separate state and takes no part in the ranking.

## Verdict criteria

Evaluation order is fixed — **catalog first, then calls, then follow-through**. The order is itself part of the contract: a skill that was never offered must not be reported as "the model did not call it", because that bills an assembly fault to the model.

| verdict | Criterion (evaluated in order; first hit wins) |
|---|---|
| `not_in_catalog` | The log has no catalog event, **or** the effective catalog does not contain the name → assembly problem |
| `not_attempted` | In the catalog, but no `skill()` call for it in this session; **or** the only call failed with `isError: true` (a failed call means the body never arrived, i.e. never successfully loaded) |
| `wrong_pick` | In the catalog, not called, **and** the session called some other skill |
| `loaded_not_effective` | Loaded successfully, but **no non-`skill` tool call follows that load** |
| `ok` | Loaded successfully, and at least one non-`skill` tool call follows that load |
| `unreported` | The caller supplied no expectation list, so nothing is decided and `missing` is empty |

### Why `loaded_not_effective` is conservative (important)

This verdict is only issued when the log directly contradicts the claim that the skill was used. Concretely, the criterion is exactly the line above:

- Only "is there **another tool** call after this successful load" is inspected. Yes → `ok`.
- A later **`skill` call is not evidence**: loading two skills in a row does not show the first one was used.
- **Everything else is `ok`.** This package does not read what the model said, does not measure answer length, and does not judge whether a deliverable reflects the skill's content — all of those require guessing, and a wrong guess is a false accusation.

**Known cost (measured).** Swept across **342 real sessions and 212 `skill()` loads** under this machine's `~/.dsh/sessions`, the number of successful loads with no following tool call was **0**. In other words `loaded_not_effective` almost never fires on real data; it appears only in the outright "loaded it and stopped" case. That is deliberate: a missed verdict beats a false one. A finer criterion (for example, checking whether the later tool calls land on the workflow the skill declares) would need semantic comparison and is out of scope — see Known Limitations.

## Data source: the real session-event shapes

Sessions are persisted at `$DSH_HOME/sessions/<cwd-encoded>/<session-id>/session.v3.jsonl.zstd`. Every event shape this package depends on was **read off real session files**, not assumed:

| What is read | Event | Key fields |
|---|---|---|
| Skill catalog | `type: "user/message"` | `data.source.kind === "skill-catalog"`; `data.source.entries[] = { name, description }` |
| Skill call | `type: "tool/call"` | `data.name === "skill"`; `data.arguments` is a **string**, e.g. `"{\"name\": \"<skill>\"}"`; `data.callId` pairs it with its result |
| Call result | `type: "tool/result"` | `data.message.content[0]` is a `tool-result` block: `toolCallId` pairs it back, `isError` marks failure, and on failure `content[0].text` reads like `Error: skill "<name>" is unknown or no longer available` |
| Follow-through | `type: "tool/call"` | `data.name` being any tool other than `skill` |

Shape provenance (read-only inspection, 2026-09-21). The `<cwd-key>` below is the session path's first directory level — the key the host derives by replacing path separators in the session `cwd` with `-`. It is elided so that no machine username or workspace path enters a public repository; the session ids are kept verbatim, so each artifact is still locatable in a local `$DSH_HOME/sessions`:

- **The catalog shape** was taken from `$DSH_HOME/sessions/<cwd-key>/session-87b49cd9-4512-4825-85ff-e4b5bbebd15d/session.v3.jsonl.zstd` (that sample's catalog holds a single skill, `find-skills`); the same shape was re-checked in **338 further** sessions with identical fields.
- **The call and result shapes** were taken from `$DSH_HOME/sessions/<cwd-key>/session-664cf104-a08e-49e0-8a71-659f743697ea/session.v3.jsonl.zstd` (16 catalog entries, one successful load).
- **The failure result** was taken from `$DSH_HOME/sessions/<cwd-key>/session-2bf09eca-b73b-4d53-96d9-0b8be7691121/session.v3.jsonl.zstd` (one catalog entry, `find-skills`, and two calls that both returned `isError: true`).
- **Catalog replacement** was taken from `$DSH_HOME/sessions/<cwd-key>/session-1b679f2c-224d-4556-9ca6-33d997bd2506/session.v3.jsonl.zstd` (three catalog events at `seq` 13 / 201 / 415 with 5 / 88 / 94 entries; the last two carry `source.update === true`).

Those readings were independently re-checked with the `zstd -d` command line, and matched this package's output item by item.

### Decoder capability probe (why not `import { zstdDecompressSync }`)

`node:zlib`'s zstd API is not present on every Node version (on Node 22 it arrives in 22.15.0). This package therefore writes **no static named import**: it does `import * as zlib from 'node:zlib'` and reads the function off the namespace. The difference is *when* the failure lands:

- A **static named import** throws `SyntaxError: The requested module 'node:zlib' does not provide an export named 'zstdDecompressSync'` during module **instantiation** — the whole host entry fails to load, and the readable `zstd_unsupported` code this package promises **can never be produced**, because the module never finishes evaluating. This repository's CI runs Node 22, so the difference is a real one, not a hypothetical.
- A **namespace read** simply yields `undefined` when the export is absent, so the call returns `zstd_unsupported` while the plugin still loads and its other surfaces are unaffected. Plaintext `.jsonl` sessions are readable on any version; only `.jsonl.zstd` needs 22.15+.

A source-level assertion in `tests/host/session.test.ts` pins this (deliberately not "the module loads" — the failure happens before any of its code would run).

### Two physical facts (both were hit)

1. **The container is concatenated frames, not one frame.** The writer appends one independently decodable zstd frame per durable batch. `node:zlib`'s `zstdDecompressSync` **decodes only the first frame**, so calling it on a real artifact returns just the session header — which looks like "the session is empty". This package locates every frame by the magic `28 B5 2F FD`, decodes them one at a time and concatenates the results. An incomplete final frame (the tail left by an interrupted append) is dropped while everything before it is still returned.
2. **Records do not always have newlines.** The earliest generation wrote one record per line; later generations append **without** a separating newline. Splitting on `\n` alone fuses a whole batch into one line, and the row fails to parse as a whole. Both are accepted here: after the line split, an uncertain line is unwound into complete JSON values using the position `JSON.parse` reports in its error.

The catalog is taken as **the last one published**, never as a union: a replacement is a complete replacement, an empty catalog is a real retirement of every earlier name, and merging historical catalogs would resurrect skills that were already retired.

Rows that fail to parse are **counted and dropped**, never repaired or guessed: a catalog event with an unusable `data` shape is skipped whole, letting an earlier readable catalog stay effective.

## Evidence on disk (optional)

When `evidenceDir` is passed, one markdown report is written to `<evidenceDir>/skill-usage-<ISO timestamp>.md` (the `:` and `.` are stripped from the file name; the report body keeps the full ISO timestamp).

The write follows the same atomic-write discipline as the repository's other packages:

- A private temporary file `skill-usage-<stamp>.md.tmp` is written in the target directory, then `rename`d onto the final name. A rename within one directory is atomic, so no reader ever sees a partial report.
- The temporary file is created with `mode: 0600` (owner read/write only).
- Every failure path removes the temporary file, leaving **no stray file** behind.
- A failed report **never overrides the audit conclusion**: the result stays `status: "ok"` with its `verdict`, plus an `evidenceError` explaining the write failure. On success it carries `evidencePath`.

## Design notes

- **Shape**: host tool only; no prompt section, no browser half, no client bundle, no `dsh.client` declaration.
- **Layering**: decompression and parsing live in `src/host/session.ts`; catalog reading, call pairing, classification and the report are pure functions in `src/host/skills.ts`; `src/index.ts` only registers the tool. Apart from the peer-provided DSH types, they import nothing but `node:` built-ins, so another host wrapper (an MCP server, for instance) can reuse them; the shared types are in `src/shared/types.ts`. Repository layout: [docs/structure.md](../../docs/structure.md).
- **Dependencies**: `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` are peers provided by the host. This package has **no third-party runtime dependency** — only `node:fs`, `node:zlib`, `node:path` and `node:os`.
- **Naming**: npm name `soia-dsh-tool-check-skills` (the official `dsh-tool-*` shape with the `soia-` prefix), entry id `tool-check-skills`, tool name `check_skills`.
- **Extension points**: registers no `tools/pre-execute` or `tools/post-execute` policy hook, listens to no events, and exposes no configuration schema.

## Configuration and events

None. The package reads no configuration and emits no events.

## License

MIT. See the repository root [`LICENSE`](../../LICENSE).

## Model Experience

### The `check_skills` tool schema

#### What the model sees

The registered tool name `check_skills`, three **all-optional** parameters `sessionPath` / `applicableSkills` / `evidenceDir`, and the verbatim description below:

##### Verbatim tool description

```markdown
Audit a session log for whether the expected skills were loaded before the work started, and why not when they were not.
```

The model-facing tool catalog is generated by the host from the registered schema; this repository produces no such catalog, so there is no catalog anchor to cite here.

#### Token effect

Fixed. While the tool is visible, its name, description and three-parameter schema enter every assembly. **Measured: the model-visible projection (the JSON of `name` + `description` + `parameters`) is 517 characters, which is `ceil(517 / 4) = 130` tokens at the host token-meter's fixed density (≈4 characters per token); `pnpm run check-token-budget` recomputes it from the built artifact and compares it with `dsh.tokenBudget.resident` in `package.json` (130), failing CI when exceeded.** This package registers **no prompt section**, so the tool block is the entire resident cost and there is no second term to add.

The parameter descriptions are deliberately minimal (134 characters across the three): all three parameters are optional, and each omission is self-explaining in the result (`source: "none"`, and `sessionPath` echoing the artifact actually read), so none of that has to be restated in resident text.

#### KV Cache effect

Prefix-stable. Every field is a constant string, the package rewrites no tool block of its own, and no existing prefix loses reuse. The prefix changes only when this package's manifest changes those strings, or when another provider changes the tool's visibility or ordering — neither of which this package owns.

### This package contributes no prompt section

`check_skills` is a **post-hoc audit** tool, not a rule the model should follow while working: what it checks is precisely whether the model loaded its skills, and writing "remember to load skills" into the resident prompt would neither enforce loading nor stop costing tokens on every request. So the package registers a tool only — `apply` never calls `ctx.systemPrompt.section`, and `inject` declares just `['tools']`. The naming derivation stops there too: there is no `tool:` section name to derive.

## Known Limitations and Deferred Work

- **`loaded_not_effective` almost never fires.** Its criterion is only "a successful load with no following non-`skill` tool call". Across 342 real sessions and 212 loads the measured hit count was 0. This is **deliberately conservative**: a missed verdict beats a false one. Raising sensitivity needs semantic comparison (checking whether the later tool calls land on the workflow the skill declares), which is a different capability this package does not have.
- **Only the `skill` tool load path is audited.** When a user types `/skill-name`, the host injects the body directly with `source.kind === "skill-invocation"`, **without** going through the `skill` tool. This package **ignores those events entirely** (it neither reads them nor counts them as loaded), so a session driven purely by `/name` is reported as `not_attempted` — a false negative, not "the model did not load it". Fixing this means folding injection events into the "already loaded" source; it is not done.
- **It cannot judge "loaded correctly, understood incorrectly".** The package proves the skill body entered the context; it does not prove the model acted on it. The "later tool call" in the criterion is **existence** evidence, not correlation evidence.
- **The `$DSH_HOME/sessions` scan is depth-limited.** It recurses 4 levels and only recognises `session`-prefixed `*.jsonl.zstd` / `*.jsonl`. Deeper or differently named logs need an explicit `sessionPath`.
- **A damaged session is handled best-effort.** Rows that fail to parse are **counted and dropped without failing** — but that count (`malformedLineCount`) currently lives in the internal structure and is not surfaced in the result. The incomplete final zstd frame is dropped, and `truncatedTail` is likewise not surfaced. Telling "the session really loaded no skill" apart from "the log was truncated so we cannot see it" requires putting both counters into the result.
- **Compatibility is unverified.** The `dsh.compatibility.dsh` range `>=0.1.0-rc.8 <0.2.0` follows ecosystem convention; under strict node-semver semantics that range does **not** match prereleases, so the peer dependencies enumerate the published prereleases one by one. This package has **not** been verified loading in a live profile (the `pluginInventory/list` → `fiberPhase: active` step), and no model-initiated call has been exercised.
- **The zstd cases skip rather than pass on older Node.** The zstd tests use `it.skipIf` and are skipped on a Node build without `zstdCompressSync` (this repository's CI runs Node 22, so they execute only on 22.15+). A green suite below 22.15 therefore does not mean the zstd path was verified; locally it was exercised in full on Node 26.9.0.
- **The shape readings carry a sampling bias.** The event shapes above come from 342 sessions under this machine's `~/.dsh/sessions`, all written by one DSH version. A new DSH generation (say `session.v4.jsonl.zstd`) may change them; re-read the shapes then instead of reusing this page.

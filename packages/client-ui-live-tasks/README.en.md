---
description: "DSH Web panel: the current session's task state — last tool call, last event, and whether it is still running — folded on the host and read from a projection, with no client RPC."
kind: "package-bundle"
---

# soia-dsh-client-ui-live-tasks

Shows the current session's task state in the Web GUI as it happens: the last tool call, the last event, and whether the agent is still running. It replaces polling a log file to find out where a task got to — the host folds the session event stream and the page reads the result.

[中文](README.md)

## What this package does

While a turn is running, the three facts a reader wants are: **is it still running**, **what did it call last**, and **what was the last event**. All three are already in the session log; none of them is laid out anywhere.

This package folds `session/event` and `agent/assistant-stream` into one small state object (`LiveTaskState`) and puts a read-only panel in the session header:

- **Trigger** — a status dot and a short label. When a tool is in flight the label is the tool name (`bash`); otherwise it reads `running` or `idle`. A session with no events renders no control at all.
- **Popover** (click to open, Escape or a press outside to close):

| Row | Content |
|---|---|
| State | `waiting for a tool result` / `running` / `ended` / `idle` |
| Turn / step | The open turn and step numbers, or "none" |
| Last tool call | Tool name plus `in flight` / `settled` / `failed` |
| Tool calls this turn | Calls issued inside the open turn |
| Last event | Event type, with the tool name appended for tool events |
| Ended | The last turn's `TurnEndReason.kind`, such as `completed`, `aborted`, `error` |

### What the panel does not show

- **Live assistant text progress.** It comes from `agent/assistant-stream`, which is a process-local frame that never reaches the log, so no projection can carry it; it exists only in the host-side `ctx.liveTasks`. The panel does not render a progress figure that would always read zero.
- **Tool arguments and results.** It answers "what is running", not "what did it say".
- **History.** Only the latest state — no turn list, no timing statistics.
- **Background jobs.** That is the official `dsh-client-ui-jobs` surface; see below.
- **Any write action.** The panel is strictly read-only: no cancellation, no retry.

## The boundary with the official `dsh-client-ui-jobs`

The two look similar by name and cover different things. They are complementary:

| | `dsh-client-ui-jobs` (official) | This package |
|---|---|---|
| Source | The in-process `ctx.jobs` registry, mirrored as `jobsBySession` | The session event stream (`session/event`) plus the process-local model stream |
| Subject | **Background jobs** — work explicitly started with `run_in_background` | **Session task state** — what the current turn is doing |
| Lifetime | The registry **does not survive a restart**: a restart empties the list while the transcript keeps the `run_in_background` cards that started those jobs | Folds the **durable log**: after a restart the host refolds and the state is still there (the projection cache only affects cold-read speed) |
| External CLI processes | **Not represented** — an external CLI process is not an in-process job, so the registry cannot see it | Visible whenever the session's own tool call started it, because `tool/call` and `tool/result` are in the log |
| Time axis | Each job's start, finish, and duration | The last tool call and the last event |

A session can have no jobs at all while a long foreground tool runs — the jobs panel is absent and this one has content. Conversely, a background job can be running while the current turn is idle — this panel reads `idle` and the jobs panel reads running. With both mounted, jobs (`order: 20`) comes first and this package (`order: 30`) follows.

## Installing

Not published to npm yet. For a git-source install see [CONTRIBUTING.md](../../CONTRIBUTING.md); `cordis.patch.yml` contributes one `insert` row: `id: ui-live-tasks`, `name: soia-dsh-client-ui-live-tasks`.

> **Current state: neither artifact is deliverable.** `lib/client.js` does not exist, and `lib/index.js` exists but is **stale** — a root-side build produced it before the source settled, and it must be rebuilt before commit. The reason and the evidence are in [Client-half build status](#client-half-build-status). What is deliverable today is **source, type artifacts, and tests** — not an installable plugin.

## Data source and derivation

### One pure function, run by both halves

`src/shared/live-task-state.ts` is the whole derivation, shaped as a reducer:

```ts
reduceLiveTask(state: LiveTaskState, observation: LiveTaskObservation): LiveTaskState
```

It **imports nothing** — no DSH type, no clock, no global — so unit tests can cover it completely (`tests/shared/live-task-state.test.ts`, 33 cases) and the host and browser halves are guaranteed to fold the **same object** instead of drifting apart as two implementations.

The ordering contract is at the top of the module: durable events are ordered by `seq`, and an observation whose `seq` is not greater than the highest already folded is dropped (duplicate frames and stale replays both take that path and return the same state reference, producing no downstream work at all). Text deltas have no `seq`; they apply only to the currently open `(turn, step)` and only when their `time` does not run backwards.

### Host half

`src/index.ts` registers two things:

1. **`ctx.liveTasks`** (`src/host/live-task-store.ts`) — the host-side liveness surface. It subscribes to `session/event`, `agent/assistant-stream`, and `session/disposed`, keeps state per session, and offers `read()` / `snapshot()` / `onChanged()`.
2. **The `liveTask` projection unit** (`src/host/live-task-projection.ts`) — one projection unit on `ctx.sessionProjections`. The registry drives it over every committed `session/event` and mirrors whole values into the page.

Why a projection instead of a private RPC: the official `dsh-session-projection` is the seam built for "a client needs current per-session state the host computed, without replaying the log". The registry owns the subscription, the watermark, change notification, and snapshots; this package contributes one pure fold and two schemas. The browser half therefore needs **no request of its own** — the seat it reads is one the standard slot kit already hands it.

The projection's client view is a **strict subset** of the host state: `streamedTextLength` and `streamedAt`, the two fields only transient frames move, stay on the host and never cross the wire. Shipping a field that is constant zero would only invite a panel to treat it as a meaningful signal.

A `chunk` frame on `agent/assistant-stream` carries no `turn`/`step` (only the `start` frame does), so the store remembers where each session's open attempt sits; a chunk naming an attempt no `start` announced is dropped. A reconnect loses transient progress, never durable state.

### Browser half

`src/client/index.ts` registers the dictionaries and the session-header action; `src/client/LiveTasksAction.tsx` reads the value through the standard slot prop `useProjection('liveTask')` and renders it. `undefined` means **capability absent** (the host unit is not mounted, or no snapshot has carried the key yet) and renders as nothing, never as an invented empty state.

## Client-half build status

**`lib/client.js` is not produced. The source passes a type-check.** Both sentences matter; reading only one misreads this package's state.

Evidence obtained (as of 2026-09-21 17:55; parallel tasks were changing the workspace at the same time, so these facts are pinned to that instant):

| Check | Result |
|---|---|
| `pnpm --filter soia-dsh-client-ui-live-tasks run build:types` | ✅ passes; runs both the host and the client program and emits `lib/types/**/*.d.ts`, including `lib/types/client/index.d.ts`, the path `exports["./client"].types` declares |
| Client-half type-check | ✅ `tsc -p tsconfig.client.json --noEmit`, 0 errors |
| `pnpm vitest run packages/client-ui-live-tasks` | ✅ 65 cases pass |
| `pnpm exec oxlint packages/client-ui-live-tasks` | ✅ 0 warnings, 0 errors |
| `lib/index.js` (host bundle) | ⚠️ present but **stale**: 187,588 bytes, built root-side at 17:44:01, before several later source fixes |
| `lib/client.js` | ❌ **does not exist** |
| Real load and UI render | ❌ **never happened** |

### What the type-check actually rested on

The browser half can be type-checked because a parallel task already ran `pnpm install`, pulling this package's `react`, `@types/react`, and `@deepseek-ai/dsh-client-*` devDependencies into the workspace.

A package compiled on its own must **name the contracts it extends**. The official monorepo has one client-wide aggregate tsconfig, so every client package sits in the same program and `declare module` augmentations apply for free; this package compiles alone, so `src/client/index.ts` opens with four `import type {} from '@deepseek-ai/dsh-client-*/client'` lines that bring in the SlotMap entry (ui-conversation), the session standard kit `useProjection`/`useSession` (ui-session), `ctx.slots` (ui-renderer), and `ctx.locale` (locale). All four are type-only, so the browser bundle gains no runtime dependency from them.

**One deviation must be stated.** `@deepseek-ai/dsh-client-ui-renderer` is the sole declaring module for `ctx.slots`, and it is **not in the workspace pnpm store**. To run this type-check, the package carries a hand-copied fixture at `node_modules/@deepseek-ai/dsh-client-ui-renderer` (the same published version, with its `cordis` pointed back at the workspace instance — otherwise its declarations merge onto a different `Context`). That fixture is inside the `.gitignore`d `node_modules` tree and does not enter the repository; its legitimate equivalent is the maintainer adding the dependency and running `pnpm install` (the manifest already declares it). **The "0 errors" result rests on that fixture**; a pnpm-managed install should reach the same conclusion, but that re-run is the maintainer's to make.

### The one step that is genuinely missing

**The shared Client tsdown preset is neither in this repo nor published to npm.** Official packages name it in a `package.json` comment (`packages/client/tsdown.client.ts`), and the `dsh-client-modules` README lists it as the step that "stamps `lib/client.js`" during development. It owns capability this package has none of: wrapping the ESM entry as the lazy-CJS `window.__ModuleLoader__.load({ id, factory: (require) => … })` factory, compiling `*.module.css` into hashed class names plus a style injection, resolving `react` / `react/jsx-runtime` and `dsh.client.external` into `require(...)`, and stamping a revision on the entry after every package-local chunk is written. Without it `lib/client.js` cannot be produced in a usable form.

On the browser branch the root `tsdown.config.ts` has gained: it discovers `packages/*/src/client/index.tsx`, while this package's client entry is `src/client/index.ts`, so that branch does not select it. **This package does not bend to fit that branch**: a plain `platform: 'browser'` ESM bundle is not the shape `dsh-client-modules` serves — an official `lib/client.js` wraps its whole body in `window.__ModuleLoader__.load({ id, factory: (require) => … })`, the host ships the file to the page as a script, and the page's facade registers the factory through that `load()` call. A plain ESM bundle would load and then register nothing. The correct fix is to add the shared preset, not to rename the entry in exchange for an artifact in the wrong format.

### The host artifact is stale

`lib/index.js` is a **root-side build** artifact, not something this package proved: the root `tsdown.config.ts` now discovers entries by `packages/*/src/index.ts`, so the host half does get built. It must be rebuilt — CI's `verify:lib` rebuilds and compares against the committed `lib/`, and a stale tree fails. This package did not run a root-level build, per its task constraints, so it did not rebuild the artifact either.

That same build surfaced one root-side policy question: the bundle is 187 KB because `zod` — a runtime dependency in this package's `dependencies` — is **inlined**, while the root config's `deps.neverBundle` covers only `/^@deepseek-ai\//` and `playwright-core`. The verified boundary: `@deepseek-ai/cordis` stays external, and `@deepseek-ai/dsh-session` appears only as `import type` and is erased at runtime, so the bundle has no corresponding external import.

### One root-side gap already closed

The root `tsconfig.json` now carries `"exclude": ["packages/*/src/client/**"]` (added by a parallel task). That is exactly where a single package's client source belongs: the browser half is covered by each package's own `tsconfig.client.json`, and the root program no longer tries to compile it with host options (no DOM, no `jsx`). Root `pnpm run typecheck` therefore no longer reports TS2307 for this package's client source.

**None of these gaps was worked around**: no client source was deleted to make a check go green, and no hand-rolled `lib/client.js` was faked. The browser half now stands up at the type level, but it has **never been built, loaded, or rendered**, and no claim that it "should appear in the UI" has evidence behind it.

### The panel's visible range is exactly what the projection carries

The projection is driven only by **committed session events**. Every field in the panel therefore has a provenance in the durable log, and refolding after a page reload or a host restart yields the same value. The cost is that fields only transient frames can move (above) never reach the page.

## Design notes

- **Shape**: a client-bundle package (`dsh.client` plus `exports["./client"]`) that also contributes a host projection. It registers no tool, adds no prompt section, and writes no message content, so `dsh.tokenBudget.resident` is 0.
- **Layering**: `src/shared/` is dependency-free and runs on both sides; `src/host/` is the Node-side subscription and schemas; `src/client/` is browser rendering. The three are split so the browser bundle cannot pick up something only Node can run. See [docs/structure.md](../../docs/structure.md).
- **Name derivation**: npm package `soia-dsh-client-ui-live-tasks`; entry id and plugin name `ui-live-tasks` (the package name minus `soia-dsh-client-`); projection key `liveTask`. The client-face step follows the official packages: `@deepseek-ai/dsh-client-ui-jobs` is `id: ui-jobs` in the shipped Web composition's `cordis.patch.yml`. Every step is pinned by the `name derivation` cases in `tests/host/index.test.ts`.
- **Dependencies**: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-agent`, and `@deepseek-ai/dsh-session-projection` are peers provided by the host; `zod` is this package's runtime dependency, used to validate state and view at the registry boundary (the official projection units do the same).
- **Registration is the side effect**: both listeners, the projection unit, and the service all register on the plugin's fiber and unregister with it; no module-level cross-plugin mutable state.
- **Extension points**: no policy hooks, no config schema, no events of its own.

## Configuration and events

No configuration. The package emits no Cordis event of its own; `ctx.liveTasks.onChanged(listener)` is an in-process host subscription, not a bus event.

## License

MIT. See the repository's [`LICENSE`](../../LICENSE) for the copyright line.

## Model Experience

None, as this package registers no tool, contributes no prompt section, and adds no message content; it folds session events into a read-only projection for a human-facing Web panel.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **`lib/client.js` is not produced, and the host artifact is stale.** The client source passes a type-check, but the missing shared Client preset keeps the bundle from being produced; the host bundle came from a root-side build that predates the final source. See [Client-half build status](#client-half-build-status) for the exact evidence level. This is the package's largest gap: the source and type artifacts are in the repository; an installable, trustworthy artifact is not.
- **`ctx.liveTasks` has no consumer.** It exists because `agent/assistant-stream` is process-local and the projection wire cannot carry it, so a host-side landing place is needed; but no second package in this repository reads it. It is a surface prepared for diagnostics and future host consumers, not a verified capability.
- **The panel cannot show streaming text progress.** See "What the panel does not show". Carrying progress to the page would need a wire for transient frames, and the projection registry is by contract driven only by committed events.
- **The projection key is process-wide, not a per-session capability signal.** If any preset registers `liveTask`, the key appears in every session's snapshot; the panel reads the value, not the key's presence (the official `dsh-session-projection` README lists this as a limit of that registry itself).
- **Latest state only, no history.** The fold keeps "now": the next `turn/start` resets the previous turn's tool calls, and turn lists and timing statistics are out of scope.
- **The end reason is a protocol token, not localized copy.** The panel shows `TurnEndReason.kind` verbatim (`completed`, `aborted`, `error`, …). Translating it needs a mapping table that grows with the protocol; that is not done here.
- **Replayed transient text deltas double-count.** Text deltas carry no sequence number and are filtered only by `time` and the open step, so genuine deltas inside one millisecond all count and so do replayed transient frames. It is a display-layer count skew, it is zeroed by that step's durable `assistant/message`, and it affects no other field.
- **`streamedTextLength` is host-only.** It measures "the model is writing", but the client half cannot read it; a host consumer must decide for itself what the field is for.
- **Compatibility is untested.** The `dsh.compatibility.dsh` range `>=0.1.0-rc.8 <0.2.0` is the ecosystem's conventional spelling; under node-semver's strict semantics it does not match prereleases, which is why the peer dependencies enumerate published prerelease versions. This package has **never been loaded in any profile**: there is no `--dump-config` configuration-layer evidence, no `pluginInventory/list` activation evidence, and no real UI render.

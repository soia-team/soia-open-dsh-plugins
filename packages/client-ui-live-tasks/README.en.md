---
description: "DSH Web panel: the current session's task state — last tool call, last event, and whether it is still running — folded on the host and read from a projection, with no client RPC."
kind: "package-bundle"
---

# soia-dsh-client-ui-live-tasks

Shows the current session's task state in the Web GUI as it happens: the last tool call, the last event, and whether the agent is still running. It replaces polling a log file to find out where a task got to — the host folds the session event stream and the page reads the result.

[中文](README.md)

## What this package does

While a turn is running, a person asks four questions: **what is it doing now**, **what has it done**, **when did it do it**, and **how did that turn out**. All four facts are already in the session log; none of them is laid out anywhere.

This package folds `session/event` and `agent/assistant-stream` into a small state object (`LiveTaskState`) and registers one read-only view tab, 「任务」, beside the built-in conversation and trajectory tabs (`conversation.view`, `order: 20`):

The panel is organised as **modules**, each answering one question:

| Module | Contents |
|---|---|
| **Overview** | a card grid: state, position (`#1 · step 2`), tool calls, failures (shown in red when non-zero) |
| **Running now** | one line per in-flight call: state dot, tool name, argument summary (command, path, or `selector @ page`), seconds so far |
| **Activity log** | a five-column table — **time** · **tool** · **what it did** · **took** · **result** — with an "All N / Failures only N" filter and failed rows tinted red |
| **Just happened** | up to three plain-language phrases: `model replied`, `bash returned`, `finished working`; transport receipts never appear |

The module boundaries are the design: each one owns its copy key prefix (`overview.*`, `running.*`, `log.*`, `recent.*`) and its own empty state, so a module can be read, translated or removed on its own.

**Failure is read from two layers.** The harness-level `isError`, and a tool reporting failure inside a *successful* result — this ecosystem's convention is `{"status":"error","code":…}`. That second layer was measured, not assumed: a failed page load and a missing file both showed as done with a failure count of zero before it existed.

Copy follows the host language (`liveTasks` namespace; the two dictionaries are pinned to each other by `Record<LiveTaskKey, string>`). Tool names and event types are **deliberately not translated**: they are protocol identifiers, and paraphrasing them would hide which tool actually ran.

### What the panel does not show

- **Assistant streaming progress.** It comes from `agent/assistant-stream`, an in-process frame that never reaches the log, so it cannot cross the projection wire; it exists only host-side on `ctx.liveTasks`. The panel will not show a progress bar that is always zero.
- **Full tool output.** The result column carries the first line only (JSON answers are folded into `key=value` pairs); read the transcript for the whole thing.
- **Complete history.** The activity log is a bounded window (last eight calls, last six events), not an audit record.
- **Background jobs.** That is the official `dsh-client-ui-jobs` surface, below.
- **Any write action.** The panel is strictly read-only: it cannot cancel or retry.

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

## How the browser half is built

**`lib/client.js` is produced by `scripts/build-client.mjs`, in the same shape the official packages ship, and it has been loaded and rendered in a real profile.**

The shared client preset the official packages use (harness repo `packages/client/tsdown.client.ts`) is not published to npm, so this repository reproduces the part a plugin needs: bundle to CommonJS with tsdown (`react`, `react/jsx-runtime` and every `@deepseek-ai/*` package left external), then wrap the body in `window.__ModuleLoader__.load({ id, factory: (require) => … })` with `module`/`exports` created inside the factory and `return module.exports` at the end.

| Check | Result |
|---|---|
| `pnpm run build:client` | ✅ produces `lib/client.js` (~19 KB, `require("react/jsx-runtime")` and `require("@deepseek-ai/dsh-client-ui-primitives")`, no ESM leftovers) |
| Client type-check | ✅ `pnpm run typecheck:client`, 0 errors |
| Load | ✅ a throwaway profile boots; `dsh-client-modules` refuses to start when a declared client artifact is missing, so "it boots" means "the artifact composes" |
| Render | ✅ the 「任务」 tab renders beside the built-in tabs in a real session with no page errors; the activity log shows tool names, arguments, times and results |

**Styles do not go through a CSS module.** Standing up the preset's lightningcss pipeline for one layout skeleton is not worth it: `src/client/styles.ts` injects a `<style data-plugin-css="ui-live-tasks">` tag directly, and every class name carries an `lt-` prefix so it cannot collide with the page's generic names.

**The client `inject` list must include `sessions` and `uiConversation`.** The standard slot prop `useProjection` is assembled from the injected services; without them the artifact loads and renders nothing — a trap this package actually fell into once, recorded in [docs/verification.md](../../docs/verification.md).

### The projection is driven only by committed events

Every field in the panel can be traced to the durable log, and re-folding after a page or host restart yields the same values; the price is that fields driven by transient frames (streamed text length) never reach the page.

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

- **`ctx.liveTasks` has no consumer.** It exists because `agent/assistant-stream` is an in-process frame the projection wire cannot carry, so a host-side landing spot was needed; no second package reads it. It is a surface prepared for diagnostics and a future host consumer, not a verified capability.
- **The panel cannot show streaming text progress.** See "What the panel does not show". Showing it would need a wire that carries transient frames to the browser, and the projection registry is by contract driven only by committed events.
- **The activity log is invisible in a brand-new session.** With no activity the tab does not render at all (measured: a fresh session's view strip has no 「任务」), so `view.empty` is unreachable in practice and covered by unit tests only.
- **The projection key is process-wide, not a per-session capability signal.** Once any preset registers `liveTask`, every session's snapshot carries the key; the panel reads the value, not the key's presence (the official `dsh-session-projection` README lists this as a limitation of the registry itself).
- **Latest state only, no history.** The fold keeps "now": the next `turn/start` resets the previous turn's tool calls, and the activity log is a window of the last eight calls rather than an audit record.
- **Stream frames (`agent/assistant-stream`) do not attach in the local Web profile.** That event is dispatched inside the agent's own scope, so the package attaches lazily from `session/event` to the agent it looks up through `ctx.agents`; measured, `agents.list()` stays empty (the panel's health row shows `Agents attached 0 / Registry size 0`). **Nothing the panel displays depends on that feed** — every field comes from durable events; the only effect is that the freshness line follows durable events. The counters put the limitation in front of the user instead of letting it look like normal operation.
- **The end reason is a protocol token, not localized copy.** The panel shows `TurnEndReason.kind` values (`completed`, `aborted`, `error`, …) verbatim, and the reason behind them is unknown. Turning them into human wording needs a map that grows with the protocol; that map does not exist yet.
- **Replayed transient text deltas double-count.** Text deltas carry no sequence number and are filtered only by `time` and the open step; genuine deltas within one millisecond all count, and so do replayed transient frames. This is a display-layer count deviation, it is zeroed by that step's durable `assistant/message`, and it affects no other field.
- **`streamedTextLength` is host-only.** It measures "the model is writing", but the browser half cannot read it; host consumers must decide what the field is for.
- **Compatibility was verified on the maintainer's machine only.** The `dsh.compatibility.dsh` range `>=0.1.0-rc.8 <0.2.0` follows ecosystem convention; under strict node-semver semantics such a range does not match prereleases, which is why the peer dependencies list the published prereleases individually. Loading and rendering were verified in a throwaway profile and a demo profile on the maintainer's machine (composition row via `--dump-config`, "enabled" in the built-in plugin list, a real session render) — **not** in a customer environment.

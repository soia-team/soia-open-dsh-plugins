/**
 * `ui-live-tasks` — host half. Derives the current task state of every live
 * session from the durable `session/event` log plus the process-local
 * `agent/assistant-stream`, and serves it to the Web panel through the
 * `liveTask` session projection.
 *
 * This package registers no tool, contributes no prompt section, and adds no
 * message content, so its resident token budget is zero. The browser half ships
 * as `exports["./client"]` and is discovered through the `dsh.client`
 * declaration; nothing here is model-visible.
 *
 * @module soia-dsh-client-ui-live-tasks
 */
import type { Context } from '@deepseek-ai/cordis';
import { LiveTaskStore } from './host/live-task-store.ts';
/**
 * Loader row id, and the plugin's own name.
 *
 * Derived the official way for a client bundle: the package name minus the
 * vendor prefix and the `dsh-client-` face marker. The official
 * `@deepseek-ai/dsh-client-ui-jobs` loads under the id `ui-jobs`, and
 * `soia-dsh-client-ui-live-tasks` therefore loads under `ui-live-tasks`.
 * `tests/host/index.test.ts` pins the derivation so a rename cannot leave the
 * manifest, the patch row, and this name disagreeing.
 */
export declare const name = "ui-live-tasks";
/**
 * The projection registry owns the wire mirror this package serves through, so
 * it must exist before `apply` runs.
 *
 * `agents` is what makes the streaming feed reachable: `agent/assistant-stream`
 * is declared `this: Scoped<Agent>` and dispatched inside the agent's own scope,
 * so a listener on this plugin's entry context never receives it. Injecting the
 * registry gives the store a way to reach each live agent and attach there.
 */
export declare const inject: string[];
/**
 * Install the host surface.
 *
 * Split out of {@link apply} so tests and embedding hosts can hold the store
 * they just created instead of digging it back out of the context.
 * @param ctx - host context carrying `sessionProjections`.
 * @returns the store registered as `ctx.liveTasks`.
 */
export declare function installLiveTasks(ctx: Context): LiveTaskStore;
/**
 * Cordis plugin body.
 * @param ctx - host context.
 */
export declare function apply(ctx: Context): void;

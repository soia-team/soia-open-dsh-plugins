/**
 * The live-task derivation: one pure reducer over a session's observation
 * stream. This module imports nothing, reads no clock, and touches no global —
 * `reduceLiveTask(state, observation)` is a function of its arguments alone, so
 * every branch is directly testable and both halves of the plugin can run the
 * identical fold.
 *
 * Why a fold instead of a store: the host sees `session/event` and
 * `agent/assistant-stream` frames, and the browser sees the session event
 * window the Session Controller mirrors into the page. Both are ordered
 * streams with the same durable seq, so one reducer serves both and the two
 * halves cannot drift apart.
 *
 * Ordering contract. Durable events are ordered by `seq`: an event whose seq is
 * not greater than the highest seq already folded is a duplicate or a stale
 * replay and is dropped without touching the state. Text deltas carry no seq,
 * so they are ordered by `time` and are accepted only for the currently open
 * `(turn, step)`.
 */
import type { LiveTaskObservation, LiveTaskState } from './types.ts';
/**
 * The state before any observation. Frozen and exported so callers and tests
 * share one identity instead of rebuilding an equal-looking literal.
 */
export declare const INITIAL_LIVE_TASK_STATE: LiveTaskState;
/** Display summary of one durable event. */
/** How many recent observations the view keeps for its trail. */
export declare const RECENT_EVENT_LIMIT = 6;
/** How many finished calls the activity log keeps. */
export declare const ACTION_LIMIT = 8;
/**
 * Turn a tool call's arguments into one display line.
 *
 * The session records `data.arguments` as a JSON **string** (occasionally as an
 * already-parsed object), and the useful part differs per tool: a shell call is
 * its command, a file call its path, a fetch its URL. Unknown shapes fall back
 * to the first string value, and an unreadable payload reports `null` rather
 * than a guess — a wrong line here would be worse than no line.
 * @param data - the `tool/call` event payload, already narrowed to an object.
 * @returns one clipped line, or null when nothing readable was carried.
 */
export declare function summarizeToolArguments(data: Record<string, unknown> | undefined): string | null;
/**
 * Decide whether a tool call failed, from both places a failure can be written.
 *
 * A tool can fail the way the harness notices (`isError` on the result block) or
 * the way this ecosystem's tools usually report it: a successful tool call whose
 * payload says `{"status":"error","code":…}`. The panel is for a person, and "the
 * call worked but the operation failed" must not read as 完成 — measured live,
 * where a failed page load and a missing file both showed as completed.
 * @param data - the `tool/result` payload.
 * @param harnessError - the harness-level error flag, if the caller read one.
 * @returns true when either layer reports a failure.
 */
export declare function toolResultFailed(data: Record<string, unknown> | undefined, harnessError?: boolean): boolean;
/**
 * First non-empty line of a tool result, clipped.
 *
 * A tool's answer can be kilobytes; the activity log needs only enough to say
 * "it came back with something" — a failing call is reported by its error line.
 * @param data - the `tool/result` payload.
 * @returns one clipped line, or null when the result carried no text.
 */
export declare function summarizeToolResult(data: Record<string, unknown> | undefined): string | null;
/**
 * Fold one normalized observation into the live-task state.
 * @param state - state before this observation.
 * @param observation - one durable event or one transient text delta.
 * @returns the next state; the same reference when the observation changes nothing.
 */
export declare function reduceLiveTask(state: LiveTaskState, observation: LiveTaskObservation): LiveTaskState;
/**
 * Fold a whole observation stream from the initial state.
 * @param observations - observations in arrival order.
 * @returns the state after the last one.
 */
export declare function foldLiveTasks(observations: readonly LiveTaskObservation[]): LiveTaskState;
/**
 * Whether the session has shown anything at all.
 *
 * A surface that renders only when there is something to say uses this to stay
 * completely absent for a session that never produced an event.
 * @param state - current state.
 * @returns true once any observation, durable or transient, has been folded.
 */
export declare function hasLiveActivity(state: Pick<LiveTaskState, 'updatedAt'>): boolean;

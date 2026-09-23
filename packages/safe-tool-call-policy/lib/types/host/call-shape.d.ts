/**
 * Call adapter: reduce a pending tool call to the single line a rule pattern is
 * matched against. Everything here is total — a call whose arguments are
 * missing, frozen, or of the wrong shape reduces to an empty text instead of
 * throwing, because a policy defect must never become a failed call.
 */
import type { ToolCallShape } from '../shared/types.ts';
/**
 * Reduce a pending call to `{ tool, text }`.
 *
 * @param tool - tool name as the harness knows it (`exec.name`).
 * @param args - the call's parsed arguments (`exec.arguments`).
 * @returns the matchable shape. Unknown tools, and understood tools called
 *   without their identifying argument, yield an empty text that matches no
 *   shipped rule; a `*` rule written for such a tool can only match on an
 *   explicit empty-text pattern, which no shipped rule uses.
 */
export declare function callShapeOf(tool: string, args: unknown): ToolCallShape;

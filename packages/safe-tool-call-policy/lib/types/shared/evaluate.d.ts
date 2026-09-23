import type { PolicyDecision, PolicyRule, ToolCallShape } from './types.ts';
/**
 * Match one call against the effective rule set.
 *
 * @param call - the pending call reduced to `{ tool, text }`.
 * @param rules - effective rules in evaluation order (built-in list with the
 *   project override layer already merged).
 * @returns the strictest verdict — `allow` when nothing matched — with the
 *   deciding rule's reason and remedy, every matching id, and any note.
 */
export declare function evaluateCall(call: ToolCallShape, rules: readonly PolicyRule[]): PolicyDecision;

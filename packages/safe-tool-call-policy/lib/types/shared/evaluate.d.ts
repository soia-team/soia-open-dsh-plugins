/**
 * The pure rule matcher: one call shape plus one effective rule set in, one
 * decision out. No filesystem, no host, no DSH types — the loader feeds it the
 * merged rule list and `src/index.ts` feeds it the pending call.
 *
 * Two properties are deliberate:
 *
 * - **Deny outranks ask, then rule order decides.** A call can match several
 *   rules at once (`rm -rf ~/.app` is both a home-data write and a wholesale
 *   `rm -rf`); the strictest verdict wins, and equal verdicts are broken by the
 *   order of the rule list, so a project can put a specific rule first.
 * - **A broken rule is skipped, never fatal.** An uncompilable pattern drops
 *   that one rule and records a note; every other rule still applies. The
 *   policy never turns its own defect into a blocked or failed call.
 */
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

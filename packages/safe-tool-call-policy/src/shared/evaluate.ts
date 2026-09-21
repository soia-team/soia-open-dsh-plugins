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
import type { PolicyDecision, PolicyRule, PolicyRuleAction, ToolCallShape } from './types.ts'

/** Relative severity of the two blocking verdicts; `allow` never competes. */
const SEVERITY: Record<PolicyRuleAction, number> = { ask: 1, deny: 2 }

/**
 * Compiled patterns, keyed by source text. `evaluateCall` stays a pure function
 * of its arguments — this is a memo of a deterministic transformation, not
 * state the caller can observe.
 */
const compiledPatterns = new Map<string, RegExp | null>()

/** Compile a rule pattern, remembering (and reporting) a pattern that cannot compile. */
function compilePattern(pattern: string): RegExp | null {
  const cached = compiledPatterns.get(pattern)

  if (cached !== undefined) return cached

  let compiled: RegExp | null
  try {
    compiled = new RegExp(pattern)
  } catch {
    compiled = null
  }
  compiledPatterns.set(pattern, compiled)
  return compiled
}

/**
 * Match one call against the effective rule set.
 *
 * @param call - the pending call reduced to `{ tool, text }`.
 * @param rules - effective rules in evaluation order (built-in list with the
 *   project override layer already merged).
 * @returns the strictest verdict — `allow` when nothing matched — with the
 *   deciding rule's reason and remedy, every matching id, and any note.
 */
export function evaluateCall(call: ToolCallShape, rules: readonly PolicyRule[]): PolicyDecision {
  const matched: string[] = []
  const notes: string[] = []
  let winner: PolicyRule | undefined

  for (const rule of rules) {
    if (rule.tool !== '*' && rule.tool !== call.tool) continue

    const pattern = compilePattern(rule.pattern)

    if (pattern === null) {
      notes.push(`rule "${rule.id}": pattern is not a valid regular expression and was skipped`)
      continue
    }

    if (!pattern.test(call.text)) continue

    matched.push(rule.id)

    if (winner === undefined || SEVERITY[rule.action] > SEVERITY[winner.action]) winner = rule
  }

  if (winner === undefined) return { action: 'allow', matched, notes }

  return {
    action: winner.action,
    ruleId: winner.id,
    reason: winner.reason,
    remedy: winner.remedy,
    matched,
    notes,
  }
}

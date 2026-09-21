/**
 * Model-facing rendering of a blocking decision. This is the only text this
 * package ever puts in front of the model, and it is paid for only on the call
 * it stops — the package has no resident text at all.
 */
import type { PolicyDecision } from './types.ts'

/** Fallback reason for a decision that somehow carries none; keeps the render total. */
const FALLBACK_REASON = 'Blocked by the safe-tool-call policy.'

/**
 * Render one blocking decision as a single line: what was stopped, how to do it
 * compliantly, and which rule decided. English on purpose — the text joins a
 * tool result and is tokenized like any other model-visible output.
 *
 * @param decision - an `ask` or `deny` decision from {@link evaluateCall}.
 * @returns the reason line, never empty and never throwing.
 */
export function renderPolicyReason(decision: PolicyDecision): string {
  const parts = [decision.reason ?? FALLBACK_REASON]

  if (decision.remedy !== undefined && decision.remedy.length > 0) parts.push(decision.remedy)
  if (decision.ruleId !== undefined) parts.push(`(safe-tool-call-policy rule: ${decision.ruleId})`)

  return parts.join(' ')
}

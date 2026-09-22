/**
 * Model-facing rendering of a blocking decision. This is the only text this
 * package ever puts in front of the model, and it is paid for only on the call
 * it stops — the package has no resident text at all.
 */
import type { PolicyDecision } from './types.ts'

/** Fallback reason for a decision that somehow carries none; keeps the render total. */
const FALLBACK_REASON = 'Blocked by the safe-tool-call policy.'

/** The plugin a reader must look at when this text appears. */
const PLUGIN_NAME = 'soia-dsh-safe-tool-call-policy'

/**
 * Render one blocking decision as a single line: what was stopped, how to do it
 * compliantly, and which plugin and rule decided.
 *
 * The closing clause is a requirement, not decoration: a plugin that stops a call
 * must say who stopped it, so a reader — human or model — can go and look at that
 * plugin. An interception that reports only "rejected" leaves the reader guessing
 * between a policy, a hook, and a transient failure (which is exactly what an
 * operator reported: "I cannot tell a policy decision from a temporary fault").
 *
 * English on purpose — the text joins a tool result and is tokenized like any
 * other model-visible output.
 *
 * @param decision - an `ask` or `deny` decision from {@link evaluateCall}.
 * @returns the reason line, never empty and never throwing.
 */
export function renderPolicyReason(decision: PolicyDecision): string {
  const parts = [decision.reason ?? FALLBACK_REASON]

  if (decision.remedy !== undefined && decision.remedy.length > 0) parts.push(decision.remedy)
  if (decision.ruleId !== undefined) parts.push(`(rule: ${decision.ruleId})`)

  // 插件名称：具体报错原因 — the last thing the reader sees.
  parts.push(`插件 ${PLUGIN_NAME}：${decision.reason ?? FALLBACK_REASON}`)

  return parts.join(' ')
}

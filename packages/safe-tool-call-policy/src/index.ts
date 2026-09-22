/**
 * `safe-tool-call-policy` — a host policy plugin that reads a pending tool call
 * before it executes and stops the dangerous ones.
 *
 * It contributes **no tool and no prompt section**: nothing it owns is resident
 * in a model request, so its `dsh.tokenBudget.resident` is 0. The only text it
 * ever puts in front of the model is the one-line reason attached to a call it
 * stopped.
 *
 * Two DSH extension points, split by what the verdict means:
 *
 * - **`ask`** goes through the `tools/pre-execute` waterfall, the same seam the
 *   official policy plugins use. The registry resolves it against the approval
 *   service, so a deployment without an approval channel degrades to a denial
 *   with the registry's own wording.
 * - **`deny`** is registered with `ctx.tools.guard()`. A guard is monotonic and
 *   has no allow result, so no later listener can turn an irreversible
 *   rejection back into permission.
 *
 * Everything the package decides comes from `evaluateCall` over a rule list;
 * this module only wires the two hooks, resolves the session's project root,
 * and renders the reason. Every path is fail-open: a policy that cannot read
 * its rules allows the call and logs why.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

import { callShapeOf } from './host/call-shape.ts'
import { journalDecision } from './host/decisions.ts'
import { isReadOnlyCommand } from './shared/read-only.ts'
import { loadPolicy } from './host/policy-file.ts'
import { evaluateCall } from './shared/evaluate.ts'
import { renderPolicyReason } from './shared/reason.ts'
import type { PolicyDecision } from './shared/types.ts'
import { PolicyHealth } from './host/health.ts'

/** Cordis plugin name used by loader diagnostics; equals the entry id derived from the package name. */
export const name = 'safe-tool-call-policy'

/** The tool registry owns both extension points this package uses. */
export const inject = ['tools']

/**
 * The shipped pattern set. Resolved relative to this module, which sits one
 * level below the package root in both layouts — `src/index.ts` in the source
 * tree and `lib/index.js` in the built bundle — so the same specifier is
 * correct for tests and for an installed package.
 */
const BUILTIN_PATTERN_SET = new URL('../danger-patterns.json', import.meta.url)

/** This plugin's own decision, before it is rendered into a registry verdict. */
type Decide = (exec: Readonly<ToolExecution>) => PolicyDecision

/** The project root a call belongs to: the session workspace, or this process when there is none. */
function projectRootOf(exec: Readonly<ToolExecution>): string {
  const cwd: unknown = exec.agent?.session.header.cwd

  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

/**
 * Build the evaluator for one loaded plugin instance.
 *
 * @param ctx - the plugin context, used only to log fail-open notes.
 * @returns a total function: any internal failure resolves to `allow`.
 */
function createDecide(ctx: Context): Decide {
  return (exec) => {
    try {
      const policy = loadPolicy({ projectRoot: projectRootOf(exec), builtinUrl: BUILTIN_PATTERN_SET })

      for (const note of policy.notes) ctx.logger.warn(`safe-tool-call-policy: ${note}`)

      const shape = callShapeOf(exec.name, exec.arguments)
      // A provably read-only command skips the rules that would only ask: asking
      // about a read is friction, and the measured interception log was 25 of 31
      // calls exactly that. Deny rules still apply — reading a secret is still
      // reading a secret.
      const rules = isReadOnlyCommand(shape.text)
        ? policy.rules.filter((rule) => rule.action === 'deny')
        : policy.rules

      return evaluateCall(shape, rules)
    } catch (error) {
      // A policy defect must never fail a call: report it and let the call run.
      ctx.logger.warn(`safe-tool-call-policy: evaluation failed (${(error as Error).message}); allowing the call`)

      return { action: 'allow', matched: [], notes: [] }
    }
  }
}

/**
 * Register the two policy hooks on the plugin fiber.
 *
 * @param ctx - the plugin context; both hooks unregister when it unloads.
 */
export function apply(ctx: Context): void {
  const health = new PolicyHealth(ctx)
  /**
   * Whether each session can actually put a question to a human.
   *
   * `approval/policy` is a *session event*, not a host event, so it arrives on
   * `session/event` and is remembered per session. Measured on real sessions:
   * with the `never` policy every `ask` came back `rejected` in 0–4 ms and the
   * tool result blamed the user, who had never been shown anything. An advisory
   * rule must not become a silent hard block, so when asking is impossible the
   * rule is reported instead of enforced — `deny` rules are untouched.
   */
  const approvalPolicies = new Map<string, string>()
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'approval/policy') return
    approvalPolicies.set(session.id, event.data.policy)
  })

  // One place records every decision, so both hooks report the same counters.
  const journalPath = process.env['SOIA_POLICY_JOURNAL']

  const decideAndCount = (exec: Parameters<typeof decide>[0]) => {
    // Absent an observed switch, the deployment default applies: the host asks
    // unless a session says otherwise.
    const canAsk = approvalPolicies.get(exec.agent?.session.id ?? '') !== 'never'
    const decision = decide(exec)
    const downgraded = decision.action === 'ask' && !canAsk
    const action = downgraded ? 'allow' as const : decision.action

    health.record(action === 'deny')
    if (decision.ruleId !== undefined) health.recordMatch(decision.ruleId)
    if (downgraded) health.recordAdvisoryOnly()
    health.recordDecision(action, decision.ruleId, exec.name)

    if (decision.ruleId !== undefined) {
      // One line per interception, so a host log or a journal answers "which rule
      // stopped this, and when" without reading the plugin's memory.
      ctx.logger.warn(
        `safe-tool-call-policy: ${decision.ruleId} → ${action}`
        + `${downgraded ? ' (reported only: this session cannot ask)' : ''} on ${exec.name}`,
      )
      journalDecision({
        at: Date.now(),
        ruleId: decision.ruleId,
        tool: exec.name,
        action,
        downgraded,
        excerpt: callShapeOf(exec.name, exec.arguments).text.slice(0, 160),
      }, journalPath)
    }

    return downgraded ? { ...decision, action: 'allow' as const } : decision
  }
  const decide = createDecide(ctx)

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const decision = decideAndCount(exec)

    return decision.action === 'ask' ? { kind: 'ask', reason: renderPolicyReason(decision) } : next()
  })

  ctx.effect(
    () => ctx.tools.guard((exec) => {
      const decision = decideAndCount(exec)

      return decision.action === 'deny' ? renderPolicyReason(decision) : undefined
    }),
    'safe-tool-call-policy: deny guard',
  )
}

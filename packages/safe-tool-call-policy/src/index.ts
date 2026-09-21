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
import { loadPolicy } from './host/policy-file.ts'
import { evaluateCall } from './shared/evaluate.ts'
import { renderPolicyReason } from './shared/reason.ts'
import type { PolicyDecision } from './shared/types.ts'

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

      return evaluateCall(callShapeOf(exec.name, exec.arguments), policy.rules)
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
  const decide = createDecide(ctx)

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const decision = decide(exec)

    return decision.action === 'ask' ? { kind: 'ask', reason: renderPolicyReason(decision) } : next()
  })

  ctx.effect(
    () => ctx.tools.guard((exec) => {
      const decision = decide(exec)

      return decision.action === 'deny' ? renderPolicyReason(decision) : undefined
    }),
    'safe-tool-call-policy: deny guard',
  )
}

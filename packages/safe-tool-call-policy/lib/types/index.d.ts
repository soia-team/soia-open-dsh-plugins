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
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name used by loader diagnostics; equals the entry id derived from the package name. */
export declare const name = "safe-tool-call-policy";
/** The tool registry owns both extension points this package uses. */
export declare const inject: string[];
/**
 * Register the two policy hooks on the plugin fiber.
 *
 * @param ctx - the plugin context; both hooks unregister when it unloads.
 */
export declare function apply(ctx: Context): void;

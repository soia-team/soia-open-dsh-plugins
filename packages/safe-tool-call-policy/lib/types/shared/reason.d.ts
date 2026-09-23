/**
 * Model-facing rendering of a blocking decision. This is the only text this
 * package ever puts in front of the model, and it is paid for only on the call
 * it stops — the package has no resident text at all.
 */
import type { PolicyDecision } from './types.ts';
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
export declare function renderPolicyReason(decision: PolicyDecision): string;

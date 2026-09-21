/**
 * Model-facing rendering of a blocking decision. This is the only text this
 * package ever puts in front of the model, and it is paid for only on the call
 * it stops — the package has no resident text at all.
 */
import type { PolicyDecision } from './types.ts';
/**
 * Render one blocking decision as a single line: what was stopped, how to do it
 * compliantly, and which rule decided. English on purpose — the text joins a
 * tool result and is tokenized like any other model-visible output.
 *
 * @param decision - an `ask` or `deny` decision from {@link evaluateCall}.
 * @returns the reason line, never empty and never throwing.
 */
export declare function renderPolicyReason(decision: PolicyDecision): string;

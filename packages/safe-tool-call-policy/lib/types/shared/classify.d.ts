/**
 * Structural classification of a tool call.
 *
 * The policy's rules are a text matcher: they fire on a pattern and say nothing
 * about the call as a whole, so they cannot answer the two questions that decide
 * whether a call needs a human — *what kind of change is this* and *how far does
 * it reach* — and they cannot be calibrated, because they have no notion of
 * confidence. This module produces that missing judgement from the command's
 * structure instead of from its spelling.
 *
 * It is deliberately a classifier and not a matcher:
 *
 *  - the output is typed (`action`, `target`, `blastRadius`, `reversible`,
 *    `credentialAccess`) plus a `confidence` and the `evidence` that produced it;
 *  - it never decides. Enforcement is a separate policy decision, so the same
 *    judgement can first be logged and calibrated against real traffic (the field
 *    practice for risk gating is to observe before blocking);
 *  - it is offline and cheap, so it can run on every call.
 *
 * @module safe-tool-call-policy/shared/classify
 */
/** What the call does to the world. */
export type ActionClass = 'read' | 'write' | 'delete' | 'move' | 'network' | 'publish' | 'execute' | 'unknown';
/** Where the call acts, from least to most protected. */
export type TargetClass = 'workspace' | 'scratch' | 'data-root' | 'system' | 'remote' | 'unknown';
/** How far a change reaches if it goes wrong. */
export type BlastRadius = 'single' | 'tree' | 'machine' | 'outward';
/** One typed judgement about a call. */
export interface CommandJudgement {
    /** Dominant action across the call's segments. */
    readonly action: ActionClass;
    /** Most protected target the call touches. */
    readonly target: TargetClass;
    /** Reach of a mistake, given the action and target. */
    readonly blastRadius: BlastRadius;
    /** False when the action cannot be undone by the caller. */
    readonly reversible: boolean;
    /** True when the call reads or transmits a credential. */
    readonly credentialAccess: boolean;
    /** 0..1 — how much of the call the classifier could account for. */
    readonly confidence: number;
    /** The signals behind the judgement, for a reader and for calibration. */
    readonly evidence: readonly string[];
}
/**
 * Classify a tool call's command text.
 *
 * @param command - the command text a rule would otherwise be matched against.
 * @returns a typed judgement; never throws, and reports low confidence rather
 *   than guessing when the call is not understood.
 */
export declare function classifyCommand(command: string): CommandJudgement;

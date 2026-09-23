/** One journalled decision. */
export interface DecisionRecord {
    /** Epoch milliseconds. */
    readonly at: number;
    /** The rule that decided the call. */
    readonly ruleId: string;
    /** Tool the call was made with. */
    readonly tool: string;
    /** Action taken (after any downgrade for a session that cannot ask). */
    readonly action: string;
    /** True when the rule fired but could only be reported. */
    readonly downgraded: boolean;
    /** First 160 characters of the command, redacted. */
    readonly excerpt: string;
}
/**
 * Mask credential-shaped values.
 * @param text - raw text.
 * @returns the text with such values replaced.
 */
export declare function redact(text: string): string;
/**
 * Append one decision to the journal when it is enabled.
 * @param record - the decision to record.
 * @param path - journal path; absent means journalling is off.
 */
export declare function journalDecision(record: DecisionRecord, path: string | undefined): void;

/**
 * Runtime self-check for this package.
 *
 * A tool that only reports per-call results cannot say whether it has been
 * working: the host sees successes and failures one call at a time, and nothing
 * carries the package's own view of its behaviour. These counters do, and they
 * are exposed as a host service so a diagnostic surface (or a test) can read
 * them without the model paying for a tool schema.
 *
 * The snapshot is frozen: a caller cannot mutate the package's counters by
 * holding on to what it read.
 */
import { Service, type Context } from '@deepseek-ai/cordis';
/** What this package reports about its own behaviour. */
export interface PolicyHealthSnapshot {
    /** Calls handled since the host loaded the plugin. */
    readonly calls: number;
    /** Matches that could only be reported, because this session cannot ask. */
    readonly advisoryOnly: number;
    /** Decisions by outcome, so a sudden shift is visible without reading logs. */
    readonly byAction: Readonly<Record<'allow' | 'ask' | 'deny', number>>;
    /**
     * The most recent rule that fired, for locating a problem quickly.
     *
     * A counter tells you something happened; this tells you what, on which tool,
     * and when — the three facts needed to reproduce it.
     */
    readonly lastMatch: {
        readonly ruleId: string;
        readonly tool: string;
        readonly action: 'allow' | 'ask' | 'deny';
        readonly at: number;
    } | null;
    /** Calls that ended in a failure report. */
    readonly failures: number;
    /** Epoch milliseconds of the last call, or null before the first. */
    readonly lastCallAt: number | null;
    /** Epoch milliseconds of the last failure, or null if there has been none. */
    readonly lastFailureAt: number | null;
    /** Calls the policy asked about, by rule id. */
    readonly matches: Readonly<Record<string, number>>;
}
/** Service name the snapshot is published under. */
export declare const Policy_HEALTH_SERVICE = "safeToolCallPolicyHealth";
/**
 * Counter store behind the service.
 *
 * A `Service` rather than a plain object because that is how this host attaches
 * a lifetime: the counters disappear with the plugin instead of leaking into a
 * later composition.
 */
export declare class PolicyHealth extends Service {
    private calls;
    private failures;
    private lastCallAt;
    private lastFailureAt;
    private advisoryOnly;
    private readonly byAction;
    private lastMatch;
    private readonly matches;
    /**
     * @param ctx - host context owning this service's lifetime.
     */
    constructor(ctx: Context);
    /**
     * Record one completed call.
     * @param failed - whether the call ended in a failure report.
     * @param at - epoch milliseconds of completion.
     */
    record(failed: boolean, at?: number): void;
    /** Record one rule match.
     * @param ruleId - the rule that decided the call. */
    recordMatch(ruleId: string): void;
    /**
     * Record one decision and, when a rule fired, what it was.
     * @param action - the action actually taken after any downgrade.
     * @param ruleId - the rule that decided, when one did.
     * @param tool - the tool the call was for.
     * @param at - epoch milliseconds.
     */
    recordDecision(action: 'allow' | 'ask' | 'deny', ruleId: string | undefined, tool: string, at?: number): void;
    /** Record one rule that fired while asking was impossible. */
    recordAdvisoryOnly(): void;
    /**
     * Read the counters.
     * @returns a frozen snapshot.
     */
    snapshot(): PolicyHealthSnapshot;
}

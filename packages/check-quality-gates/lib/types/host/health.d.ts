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
export interface QualityGatesHealthSnapshot {
    /** Calls handled since the host loaded the plugin. */
    readonly calls: number;
    /** Calls that ended in a failure report. */
    readonly failures: number;
    /** Epoch milliseconds of the last call, or null before the first. */
    readonly lastCallAt: number | null;
    /** Epoch milliseconds of the last failure, or null if there has been none. */
    readonly lastFailureAt: number | null;
    /** Calls that could not produce a gate list because of the config. */
    readonly configErrors: number;
}
/** Service name the snapshot is published under. */
export declare const QualityGates_HEALTH_SERVICE = "checkQualityGatesHealth";
/**
 * Counter store behind the service.
 *
 * A `Service` rather than a plain object because that is how this host attaches
 * a lifetime: the counters disappear with the plugin instead of leaking into a
 * later composition.
 */
export declare class QualityGatesHealth extends Service {
    private calls;
    private failures;
    private lastCallAt;
    private lastFailureAt;
    private configErrors;
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
    /** Record one call that failed on its configuration rather than on its input. */
    recordConfigError(): void;
    /**
     * Read the counters.
     * @returns a frozen snapshot.
     */
    snapshot(): QualityGatesHealthSnapshot;
}

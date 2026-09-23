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
import { Service, type Context } from '@deepseek-ai/cordis'

/** What this package reports about its own behaviour. */
export interface PolicyHealthSnapshot {
  /** Calls handled since the host loaded the plugin. */
  readonly calls: number
  /** Matches that could only be reported, because this session cannot ask. */
  readonly advisoryOnly: number
  /** Decisions by outcome, so a sudden shift is visible without reading logs. */
  readonly byAction: Readonly<Record<'allow' | 'ask' | 'deny', number>>
  /**
   * The most recent rule that fired, for locating a problem quickly.
   *
   * A counter tells you something happened; this tells you what, on which tool,
   * and when — the three facts needed to reproduce it.
   */
  readonly lastMatch: {
    readonly ruleId: string
    readonly tool: string
    readonly action: 'allow' | 'ask' | 'deny'
    readonly at: number
  } | null
  /** Calls that ended in a failure report. */
  readonly failures: number
  /** Epoch milliseconds of the last call, or null before the first. */
  readonly lastCallAt: number | null
  /** Epoch milliseconds of the last failure, or null if there has been none. */
  readonly lastFailureAt: number | null
  /** Calls the policy asked about, by rule id. */
  readonly matches: Readonly<Record<string, number>>
}

/** Service name the snapshot is published under. */
export const Policy_HEALTH_SERVICE = 'safeToolCallPolicyHealth'

/**
 * Counter store behind the service.
 *
 * A `Service` rather than a plain object because that is how this host attaches
 * a lifetime: the counters disappear with the plugin instead of leaking into a
 * later composition.
 */
export class PolicyHealth extends Service {
  private calls = 0
  private failures = 0
  private lastCallAt: number | null = null
  private lastFailureAt: number | null = null
  private advisoryOnly = 0
  private readonly byAction: Record<'allow' | 'ask' | 'deny', number> = { allow: 0, ask: 0, deny: 0 }
  private lastMatch: { ruleId: string, tool: string, action: 'allow' | 'ask' | 'deny', at: number } | null = null
  private readonly matches = new Map<string, number>()


  /**
   * @param ctx - host context owning this service's lifetime.
   */
  constructor(ctx: Context) {
    super(ctx, 'safeToolCallPolicyHealth')
  }

  /**
   * Record one completed call.
   * @param failed - whether the call ended in a failure report.
   * @param at - epoch milliseconds of completion.
   */
  record(failed: boolean, at: number = Date.now()): void {
    this.calls += 1
    this.lastCallAt = at
    if (failed) {
      this.failures += 1
      this.lastFailureAt = at
    }
  }

  /** Record one rule match.
   * @param ruleId - the rule that decided the call. */
  recordMatch(ruleId: string): void {
    this.matches.set(ruleId, (this.matches.get(ruleId) ?? 0) + 1)
  }

  /**
   * Record one decision and, when a rule fired, what it was.
   * @param action - the action actually taken after any downgrade.
   * @param ruleId - the rule that decided, when one did.
   * @param tool - the tool the call was for.
   * @param at - epoch milliseconds.
   */
  recordDecision(action: 'allow' | 'ask' | 'deny', ruleId: string | undefined, tool: string, at: number = Date.now()): void {
    this.byAction[action] += 1
    if (ruleId !== undefined) this.lastMatch = { ruleId, tool, action, at }
  }

  /** Record one rule that fired while asking was impossible. */
  recordAdvisoryOnly(): void {
    this.advisoryOnly += 1
  }

  /**
   * Read the counters.
   * @returns a frozen snapshot.
   */
  snapshot(): PolicyHealthSnapshot {
    return Object.freeze({
      calls: this.calls,
      advisoryOnly: this.advisoryOnly,
      byAction: Object.freeze({ ...this.byAction }),
      lastMatch: this.lastMatch === null ? null : Object.freeze({ ...this.lastMatch }),
      failures: this.failures,
      lastCallAt: this.lastCallAt,
      lastFailureAt: this.lastFailureAt,
      matches: Object.freeze(Object.fromEntries(this.matches)),
    })
  }
}

/**
 * Public types of the skill-usage audit core. Kept free of any DSH import so the
 * core can be reused by another host wrapper (an MCP server, for example)
 * without dragging the harness types along.
 *
 * All shapes mirror what is actually persisted in a DSH session log; the exact
 * event shapes this module depends on are recorded in the package README.
 */

/** One raw event row of a session log, as far as this core cares about it. */
export interface SessionEvent {
  type: string
  seq?: number
  turn?: number
  step?: number
  data?: Record<string, unknown>
  [key: string]: unknown
}

/** Outcome of reading and parsing one session log. */
export interface SessionAnalysis {
  /** Absolute path of the artifact that was read. */
  sessionPath: string
  /** Events in log order. Rows that failed to parse are dropped, not guessed at. */
  events: SessionEvent[]
  /** How many non-empty rows were dropped because they were not valid JSON. */
  malformedLineCount: number
  /** Compressed frames merged, or 0 for a plaintext artifact. */
  frameCount: number
  /** True when a trailing bytes run after the last complete frame was dropped. */
  truncatedTail: boolean
}

/** One skill name/description pair published in the catalog. */
export interface SkillCatalogEntry {
  name: string
  description: string
}

/**
 * The session's effective skill catalog — the last complete replacement the
 * agent received. `present` is false when the log carries no catalog event at
 * all, which is a different fact from a catalog that published zero skills.
 */
export interface SkillCatalog {
  present: boolean
  count: number
  names: string[]
  entries: SkillCatalogEntry[]
}

/** Why one `skill` tool call did not produce instructions. */
export type SkillLoadFailureReason = 'call_failed' | 'no_result'

/** One `skill` tool call paired with the result that answered it. */
export interface SkillLoadRecord {
  name: string
  turn?: number
  step?: number
  seq?: number
  ok: boolean
  reason?: SkillLoadFailureReason
  /** Error text as recorded in the session, when the call failed. */
  error?: string
  /**
   * True when at least one non-`skill` tool call exists later in the log, i.e.
   * the session shows work continuing after this load.
   */
  usedAfterLoad: boolean
}

/** Everything the audit reads off one session log. */
export interface SkillUsageEvidence {
  catalog: SkillCatalog
  loads: SkillLoadRecord[]
  /** Distinct names this session called the `skill` tool with, in call order. */
  calledSkills: string[]
  /** Distinct tool names called anywhere in the session, in call order. */
  toolNames: string[]
}

/** Why the audit could not produce a verdict. Never carries a guessed verdict. */
export type CheckSkillsFailureCode =
  | 'zstd_unsupported'
  | 'session_not_found'
  | 'sessions_dir_missing'
  | 'sessions_dir_empty'
  | 'session_unreadable'
  | 'session_empty'
  | 'session_decompress_failed'

/** Failed audit: a typed reason instead of a partial or guessed answer. */
export interface CheckSkillsFailure {
  status: 'error'
  /** The plugin that produced this failure, so a reader knows where to look. */
  plugin: 'soia-dsh-tool-check-skills'
  code: CheckSkillsFailureCode
  message: string
  sessionPath?: string
}

/** One of the five per-skill classifications, plus the unreported sentinel. */
export type SkillVerdict =
  | 'ok'
  | 'not_in_catalog'
  | 'not_attempted'
  | 'wrong_pick'
  | 'loaded_not_effective'
  | 'unreported'

/** How the expected skill list was obtained. */
export type ApplicableSkillsSource = 'argument' | 'none'

/** Which skill was expected, and how it fared. */
export interface SkillVerdictRecord {
  name: string
  verdict: SkillVerdict
}

/** The catalog slice of a successful audit result. */
export interface CatalogSummary {
  count: number
  names: string[]
  /** False when the session log published no catalog event at all. */
  present: boolean
  /** Distinct skills this session actually loaded, in call order. */
  called: string[]
}

/** Successful audit. `verdict` is the worst per-skill verdict, or `unreported`. */
export interface CheckSkillsSuccess {
  status: 'ok'
  task: {
    applicableSkills: string[]
    source: ApplicableSkillsSource
  }
  catalog: CatalogSummary
  calls: SkillLoadRecord[]
  verdict: SkillVerdict
  missing: string[]
  sessionPath: string
  /** Present only when an evidence directory was requested and the write succeeded. */
  evidencePath?: string
  /**
   * Present only when an evidence directory was requested and the write failed.
   * The verdict above is still valid — a failed report never invalidates the
   * audit that was already read off the log.
   */
  evidenceError?: string
}

/** Result of one audit attempt. */
export type CheckSkillsOutcome = CheckSkillsSuccess | CheckSkillsFailure

/** Input of one audit attempt. */
export interface CheckSkillsOptions {
  /** Session log path; defaults to the newest artifact under `$DSH_HOME/sessions`. */
  sessionPath?: string
  /** Skill names this task was expected to load. Omit to get `unreported`. */
  applicableSkills?: string[]
  /** Directory to write the optional markdown report into. */
  evidenceDir?: string
}

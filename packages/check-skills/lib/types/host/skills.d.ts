import type { CatalogSummary, SessionAnalysis, SessionEvent, SkillCatalog, SkillLoadRecord, SkillUsageEvidence, SkillVerdict, SkillVerdictRecord } from '../shared/types.ts';
/** The official loader this audit keys on: `@deepseek-ai/dsh-tool-skill`. */
export declare const SKILL_TOOL_NAME = "skill";
/**
 * The `user/message` source kind the loader publishes the catalog under. Only
 * this kind is read; the surrounding `<system-reminder>` prose is never parsed,
 * because the loader documents the durable entries as the fact and the prose as
 * a rendering.
 */
export declare const SKILL_CATALOG_SOURCE_KIND = "skill-catalog";
/**
 * Source kind of a `/name` user-explicit injection. Documented but **not yet
 * consumed**: the loader injects the body directly for that gesture without
 * going through the `skill` tool, so a session driven purely by `/name` is
 * currently reported as `not_attempted`. See the README's Known Limitations.
 */
export declare const SKILL_INVOCATION_SOURCE_KIND = "skill-invocation";
/**
 * The session's effective skill catalog.
 *
 * The loader appends a complete replacement whenever the catalog changes, and an
 * empty replacement is an explicit retirement of earlier names, so the **last**
 * readable catalog event is the session's current catalog — never a union of
 * every catalog ever published.
 *
 * @param events - Decoded session events in log order.
 * @returns The effective catalog, with `present: false` when none was published.
 */
export declare function extractCatalog(events: readonly SessionEvent[]): SkillCatalog;
/**
 * Distinct tool names called anywhere in the log, in call order.
 * @param events - Decoded session events.
 * @returns Tool names, excluding `skill` itself.
 */
export declare function extractToolNames(events: readonly SessionEvent[]): string[];
/**
 * One row per distinct skill the session called, carrying the latest attempt.
 *
 * A skill loaded twice is one record: the later call is the one whose
 * follow-through decides `loaded_not_effective`, and mixing an early empty load
 * with a later productive one would accuse the session wrongly.
 *
 * @param events - Decoded session events.
 * @returns Load records in first-call order.
 */
export declare function extractSkillLoads(events: readonly SessionEvent[]): SkillLoadRecord[];
/**
 * Every derived fact the audit needs from one session log.
 * @param analysis - A decoded session artifact.
 * @returns Catalog, load records, called skills and observed tool names.
 */
export declare function collectSkillUsage(analysis: SessionAnalysis): SkillUsageEvidence;
/**
 * Normalise a caller-supplied skill list.
 *
 * Blank entries are dropped, surrounding whitespace is trimmed, and duplicates
 * are collapsed keeping first-seen order, so a repeated name cannot produce two
 * verdict rows for one expectation.
 *
 * @param names - Raw caller input.
 * @returns The cleaned list.
 */
export declare function normalizeApplicableSkills(names: readonly string[]): string[];
/** Input of one classification pass. */
export interface ClassifyInput {
    catalog: SkillCatalog;
    loads: readonly SkillLoadRecord[];
    applicableSkills: readonly string[];
}
/** Classification of one session against one expectation list. */
export interface Classification {
    verdict: SkillVerdict;
    perSkill: SkillVerdictRecord[];
    missing: string[];
}
/**
 * Classify one expected skill.
 *
 * Order matters and is deliberate: `not_in_catalog` is decided first, because a
 * skill that was never offered cannot fairly be reported as "not attempted" —
 * that would blame the model for an assembly problem.
 *
 * @param name - The expected skill name.
 * @param input - Catalog, load records and the expectation list.
 * @returns `ok`, `not_in_catalog`, `not_attempted`, `wrong_pick` or
 * `loaded_not_effective`.
 */
export declare function classifySkill(name: string, input: ClassifyInput): SkillVerdict;
/**
 * Classify every expected skill and collapse the results into one verdict.
 *
 * A skill that was called and whose instructions were followed counts as `ok`
 * even when `usedAfterLoad` is false, provided something else in the session
 * shows work continuing — the overall verdict is the worst per-skill verdict,
 * so one bad expectation is never hidden by a good one.
 *
 * @param input - Catalog, load records and the expectation list.
 * @returns The overall verdict, per-skill rows and the missing names.
 */
export declare function classifySession(input: ClassifyInput): Classification;
/**
 * The catalog slice of the result.
 * @param evidence - Collected session evidence.
 * @returns Count, names, whether a catalog was published, and what was called.
 */
export declare function summarizeCatalog(evidence: SkillUsageEvidence): CatalogSummary;
/** One rendered row of the evidence report. */
export interface EvidenceReportInput {
    sessionPath: string;
    applicableSkills: readonly string[];
    verdict: SkillVerdict;
    perSkill: readonly SkillVerdictRecord[];
    catalog: CatalogSummary;
    calls: readonly SkillLoadRecord[];
    missing: readonly string[];
    recordedAt: string;
}
/**
 * Render the optional markdown evidence report.
 * @param input - Everything the audit concluded.
 * @returns Markdown text.
 */
export declare function renderEvidenceReport(input: EvidenceReportInput): string;
/**
 * Write the evidence report atomically: a private temporary file in the target
 * directory, then a rename onto the final name. A rename within one directory is
 * atomic, so a reader never observes a partial report, and the temporary file is
 * removed on every failure path so no stray file is left behind.
 *
 * @param dir - Target directory, created when missing.
 * @param recordedAt - ISO timestamp used in the file name.
 * @param text - Report body.
 * @returns Absolute path of the written report.
 */
export declare function writeEvidenceReport(dir: string, recordedAt: string, text: string): string;

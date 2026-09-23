/**
 * `check_skills` — host tool that audits one session log for whether the skills
 * a task required were actually loaded, and names which kind of failure it was
 * when they were not.
 *
 * The whole audit lives in `./host/` and imports nothing from DSH; this module
 * only wires it to the harness tool registry. See the package README for the
 * verdict criteria, the exact session-event shapes it reads, and the token cost.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CheckSkillsOutcome } from './shared/types.ts';
export declare const name = "tool-check-skills";
/** The host service this package registers into. */
export declare const inject: string[];
/**
 * Run one audit. Exported so tests can drive the real path without the registry.
 * @param options - Session path, expectation list and optional evidence directory.
 * @returns The audit result, or a typed failure.
 */
export declare function runCheckSkills(options: {
    sessionPath?: string;
    applicableSkills?: string[];
    evidenceDir?: string;
}): CheckSkillsOutcome;
export declare function apply(ctx: Context): void;

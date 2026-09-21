/**
 * Gate core: parse the caller's config, match changed files against every gate,
 * and assemble the report. Pure functions only — no filesystem, no host import,
 * so every rule here is testable without touching a disk or a harness.
 *
 * The package ships no gate of its own. A gate exists only because the caller
 * declared it in `.dsh/gates.yml`; nothing about a project's scripts, paths, or
 * evidence format is built in.
 */
import { GATE_CONFIG_FILE_NAME, GATE_CONFIG_NOT_FOUND, type GateDefinition, type GateReport, type RequiredGate } from '../shared/types.ts';
/**
 * A config file that could not be used. Carries the source line when the
 * failure is syntactic; the message is written to be pasted into a report.
 */
export declare class GateConfigError extends Error {
    /** 1-based config line, when the failure has one. */
    readonly line: number | undefined;
    constructor(message: string, line?: number);
}
/**
 * Parse and validate a gate config.
 * @param text - Config file contents.
 * @returns The declared gates, in the order they appear in the file.
 * @throws GateConfigError On a syntax error outside the supported YAML subset, a
 * missing or mistyped field, an unknown key, or a duplicate gate id.
 */
export declare function parseGateConfig(text: string): GateDefinition[];
/**
 * Normalize the caller's changed-file list: trimmed, `\` separators folded to
 * `/`, blanks dropped, duplicates removed, sorted for a stable report.
 * @param files - Files the caller says this task changed.
 * @returns The canonical list every other function here works on.
 */
export declare function normalizeChangedFiles(files: readonly string[]): string[];
/**
 * Select the gates at least one changed file requires.
 *
 * Order is the config order, which makes the report stable across runs and
 * independent of the order the caller listed its files in. A gate matched by
 * several files appears once.
 * @param changedFiles - Normalized changed files.
 * @param gates - Declared gates, in config order.
 * @returns One entry per required gate.
 */
export declare function selectRequiredGates(changedFiles: readonly string[], gates: readonly GateDefinition[]): RequiredGate[];
/**
 * Select the changed files no gate selected. Reported instead of dropped, so an
 * unconfigured area of the workspace is visible rather than silently ungated.
 * @param changedFiles - Normalized changed files.
 * @param gates - Declared gates.
 * @returns The unmatched files, deduplicated and sorted.
 */
export declare function selectUnmatchedFiles(changedFiles: readonly string[], gates: readonly GateDefinition[]): string[];
/**
 * Assemble the complete report.
 * @param input - Changed files, the config source, the parsed gates, and an
 * optional error. When `error` is set, no gate list is produced and every
 * changed file is reported as unmatched instead of being dropped.
 * @returns The report, always with `enforcement: "none"`.
 */
export declare function buildGateReport(input: {
    changedFiles: readonly string[];
    source: string;
    gates?: readonly GateDefinition[] | undefined;
    error?: string | null | undefined;
}): GateReport;
/**
 * Readable explanation for a config file that could not be found.
 * @param searched - Directory the upward search started from.
 * @returns One sentence naming the file and the search start.
 */
export declare function gateConfigNotFoundMessage(searched: string): string;
/** Re-exported so callers of the core do not have to reach into `shared`. */
export { GATE_CONFIG_FILE_NAME, GATE_CONFIG_NOT_FOUND };

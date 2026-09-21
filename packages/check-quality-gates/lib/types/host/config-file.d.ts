import { type GateReport } from '../shared/types.ts';
/**
 * Find the nearest config file at or above `startDir`.
 * @param startDir - Directory the search starts from.
 * @returns The absolute path, or undefined when no parent holds one.
 */
export declare function findGateConfigPath(startDir: string): string | undefined;
/**
 * Produce the report for one call. Never throws: a missing, unreadable, or
 * invalid config yields a readable `error` and an empty gate list, with every
 * changed file reported as unmatched.
 * @param input - Changed files, an optional explicit config path, and an
 * optional working directory (defaults to the host process's directory).
 * @returns The complete report.
 */
export declare function resolveGateReport(input: {
    changedFiles: readonly string[];
    configPath?: string | undefined;
    cwd?: string | undefined;
}): GateReport;

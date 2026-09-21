/**
 * Public types and contract constants of the gate core. Kept free of any DSH
 * import so the core can be reused by another host wrapper (an MCP server, for
 * example) without dragging the harness types along.
 */
/**
 * Config file this tool looks for, relative to a directory. Resolution walks up
 * from the working directory, so a caller keeps the config next to the workspace
 * it describes.
 */
export declare const GATE_CONFIG_FILE_NAME = ".dsh/gates.yml";
/**
 * `source` value when no config file could be used. Spelled with angle brackets
 * so it can never collide with a real path.
 */
export declare const GATE_CONFIG_NOT_FOUND = "<not found>";
/**
 * One gate as declared by the caller's config file. Nothing here is built into
 * this package: every command, reason, evidence sentence and path pattern is
 * supplied by the caller.
 */
export interface GateDefinition {
    /** Stable identifier, unique within one config file. */
    id: string;
    /** Command the caller must run for this gate. Never executed by this package. */
    command: string;
    /** Why a change matching this gate requires it. */
    reason: string;
    /** Raw evidence the caller must paste back after running the gate. */
    rawEvidenceRequired: string;
    /** Glob patterns selecting the changed paths that require this gate. */
    paths: string[];
}
/** One entry of `requiredGates`: exactly the config fields, no match bookkeeping. */
export interface RequiredGate {
    id: string;
    command: string;
    reason: string;
    rawEvidenceRequired: string;
}
/**
 * Complete result of one call. A config problem is reported in `error` with an
 * otherwise well-formed report — the tool never throws for caller data.
 */
export interface GateReport {
    /** Requested changed files, normalized, deduplicated and sorted. */
    changedFiles: string[];
    /** Gates at least one changed file requires, in config order. */
    requiredGates: RequiredGate[];
    /** Config file the report was built from, or `GATE_CONFIG_NOT_FOUND`. */
    source: string;
    /** Always `"none"`: this tool lists gates and never blocks an unrun gate. */
    enforcement: 'none';
    /** Changed files that matched no gate, deduplicated and sorted. */
    unmatched: string[];
    /** Readable one-line reason no gate list could be produced, or null on success. */
    error: string | null;
}

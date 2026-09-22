/**
 * Public types of the hashing core. Kept free of any DSH import so the core can
 * be reused by another host wrapper (an MCP server, for example) without
 * dragging the harness types along.
 *
 * The record is deliberately narrow: a path, a digest, a size. File content,
 * base64 fragments and binary excerpts have no field to travel in, so a returned
 * value or a written evidence file can be quoted in a receipt as-is.
 */
/** One file whose bytes were hashed. Never carries the bytes themselves. */
export interface FileHash {
    /** Absolute path, resolved against the process working directory. */
    path: string;
    algo: 'sha256';
    /** Lowercase hex digest of the file's content. */
    hash: string;
    /** Size in bytes, as read before hashing. */
    size: number;
}
/**
 * Every code this package can report.
 *
 * `evidence_write_failed` is the one code that does not replace a result: a
 * failed record must not discard the measurements, so it travels on the
 * successful result as `HashSuccess.evidenceError` instead of as a top-level
 * `HashFailure`.
 */
export type HashFailureCode = 'not_found' | 'not_a_file' | 'unreadable' | 'evidence_write_failed';
/** The evidence file could not be written. The hashes in the result still stand. */
export interface EvidenceError {
    code: 'evidence_write_failed';
    message: string;
}
/** Successful check: every selected file was hashed. */
export interface HashSuccess {
    status: 'ok';
    files: FileHash[];
    /** Time the report was assembled, as an ISO 8601 string. */
    generatedAt: string;
    /** Sum of `files[].size` over the report. */
    totalBytes: number;
    /**
     * Absolute path of the written evidence file. Present only when `evidenceDir`
     * was given and the write succeeded.
     */
    evidencePath?: string;
    /** Present only when `evidenceDir` was given and the write failed. */
    evidenceError?: EvidenceError;
}
/**
 * Failed check: a typed reason instead of a partial or guessed file list.
 */
export interface HashFailure {
    status: 'error';
    /**
     * `not_found`, `not_a_file` or `unreadable`; `evidence_write_failed` is
     * declared in {@link HashFailureCode} for completeness but never appears here,
     * because it does not abort a check that already produced hashes.
     */
    code: HashFailureCode;
    message: string;
    /**
     * The plugin that produced this failure.
     *
     * Model-visible text has to name its source: given only a message, a reader
     * cannot tell which plugin to inspect, or whether a plugin was involved at all.
     */
    plugin: 'soia-dsh-tool-check-file-hash';
    /** The path the failure is about, when a single path is to blame. */
    path?: string;
}
/** Result of one check. */
export type HashOutcome = HashSuccess | HashFailure;
/** Result of hashing one path. */
export type HashOneOutcome = {
    status: 'ok';
    file: FileHash;
} | HashFailure;
/** Result of resolving caller paths into the regular files they select. */
export type CollectOutcome = {
    status: 'ok';
    files: string[];
} | HashFailure;
/** Input of one check. */
export interface HashOptions {
    /**
     * Cooperative cancellation, forwarded from the tool call. An abort rejects the
     * check with the signal's reason instead of reporting a typed failure: being
     * cancelled is not a property of the files.
     */
    signal?: AbortSignal;
}

import type { CheckSkillsFailureCode, SessionAnalysis, SessionEvent } from '../shared/types.ts';
/**
 * Typed reader failure. Carries the code the tool reports, so the caller never
 * has to translate a message string into a decision.
 */
export declare class SessionReadError extends Error {
    readonly code: CheckSkillsFailureCode;
    readonly sessionPath: string | undefined;
    constructor(code: CheckSkillsFailureCode, message: string, sessionPath?: string);
}
/**
 * `$DSH_HOME`, or `~/.dsh` when the host did not set it.
 * @returns Absolute session root directory.
 */
export declare function defaultSessionsDir(): string;
/** What one decompression pass produced. */
interface DecompressedLog {
    text: string;
    frameCount: number;
    truncatedTail: boolean;
}
/**
 * Decode a concatenated-frame Zstandard buffer.
 *
 * Frames are located by magic scan and each is handed to the one-shot decoder,
 * because the one-shot API consumes only the leading frame and reports nothing
 * about the bytes it left behind. A frame that fails to decode is treated as a
 * torn tail: its bytes stay undecoded and the text accumulated so far is
 * returned, which is what the writer leaves behind after an interrupted append.
 *
 * @param buffer - raw artifact bytes.
 * @returns Plaintext plus how many frames decoded and whether a tail was dropped.
 * @throws SessionReadError `zstd_unsupported` when this Node build has no zstd
 * decoder, or Error when no frame decodes at all.
 */
export declare function decompressZstdFrames(buffer: Buffer): DecompressedLog;
/**
 * Resolve a session artifact path that actually exists.
 *
 * A caller-supplied path is taken literally. The default resolves the newest
 * artifact under `$DSH_HOME/sessions`, searched to a bounded depth because the
 * layout is `<cwd-key>/<session-id>/session*.jsonl*`.
 *
 * @param explicit - Caller-supplied path, or undefined to pick the newest.
 * @returns Absolute path of an existing artifact.
 * @throws SessionReadError with a typed code when nothing is resolvable.
 */
export declare function resolveSessionPath(explicit?: string): string;
/**
 * Parse decoded log text into event rows.
 *
 * Every non-empty row is attempted. A row that is not valid JSON, or that JSON
 * but not an event object, is counted as malformed and dropped; it is never
 * reconstructed from neighbouring rows.
 *
 * @param text - Decoded log plaintext.
 * @returns The events in log order and the malformed-row count.
 */
export declare function parseSessionLog(text: string): {
    events: SessionEvent[];
    malformedLineCount: number;
};
/**
 * Read and decode one session artifact.
 * @param path - Absolute artifact path.
 * @returns Events, malformed-row count and frame accounting.
 * @throws SessionReadError with a typed code for every failure mode.
 */
export declare function readSessionLog(path: string): SessionAnalysis;
/**
 * Resolve and read in one step.
 * @param explicit - Caller-supplied artifact path, or undefined for the newest.
 * @returns The decoded session analysis.
 * @throws SessionReadError with a typed code.
 */
export declare function loadSession(explicit?: string): SessionAnalysis;
export {};

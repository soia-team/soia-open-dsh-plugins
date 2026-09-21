import type { EvidenceError, HashSuccess } from '../shared/types.ts';
/** Permissions of an evidence directory this package creates. */
export declare const EVIDENCE_DIR_MODE = 448;
/** Permissions of an evidence file. */
export declare const EVIDENCE_FILE_MODE = 384;
/**
 * File name of one record: `hash-<ISO timestamp>.json`.
 *
 * Every `:` is replaced with `-`, so the same name is legal on Windows, macOS and
 * Linux. The timestamp is the report's `generatedAt`, which is why the name is
 * derived from the value rather than from a second clock reading.
 * @param generatedAt - The report's ISO 8601 timestamp.
 * @returns The file name, without a directory.
 */
export declare function evidenceFileName(generatedAt: string): string;
/**
 * Absolute path of the record for one report.
 * @param evidenceDir - Directory the caller asked for.
 * @param generatedAt - The report's ISO 8601 timestamp.
 * @returns The absolute evidence file path.
 */
export declare function evidenceFilePath(evidenceDir: string, generatedAt: string): string;
/**
 * Write one record atomically.
 *
 * The temporary file is an exclusively created sibling, so a symlink planted at a
 * guessable temporary path cannot redirect the write, and it carries the final
 * mode through the rename. Any failure removes the temporary file and leaves an
 * existing record untouched.
 * @param path - Final absolute path of the record.
 * @param text - Complete file content.
 * @returns A typed failure when nothing was replaced, else undefined.
 */
export declare function writeEvidenceFile(path: string, text: string): Promise<EvidenceError | undefined>;
/**
 * Attach the written record to a finished report.
 *
 * The file content is the JSON of the returned value, `evidencePath` included, so
 * the record and the tool result can be compared field by field. When the write
 * fails the report is returned unchanged apart from `evidenceError`: losing the
 * record must not lose the measurements.
 * @param result - Successful report from the hashing core.
 * @param evidenceDir - Directory the caller asked for.
 * @returns The report with `evidencePath`, or with `evidenceError` when it could not be written.
 */
export declare function attachEvidence(result: HashSuccess, evidenceDir: string): Promise<HashSuccess>;

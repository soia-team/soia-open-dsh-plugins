/**
 * `check_file_hash` — host tool that hashes files or directories with sha256 and
 * optionally writes a JSON evidence record, so a receipt's claimed artifact can be
 * checked against the actual bytes.
 *
 * The hashing core lives in `./host/hash.ts` and the evidence writer in
 * `./host/evidence.ts`; neither imports anything from DSH, so another host
 * wrapper can reuse them. This module only wires them to the harness tool
 * registry. See the package README for the tool contract, the model-visible text,
 * and the token cost.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "tool-check-file-hash";
/**
 * The `tools` registry is host-provided and must be ready before `apply` runs.
 * This package contributes no prompt section, so `systemPrompt` is not injected.
 */
export declare const inject: string[];
export declare function apply(ctx: Context): void;

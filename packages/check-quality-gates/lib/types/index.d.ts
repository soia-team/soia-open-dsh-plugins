/**
 * `check_quality_gates` — host tool that turns "these files changed" into the
 * quality gates the **caller's config** requires, together with the raw evidence
 * each gate must paste back.
 *
 * The tool reports and stops there: it runs no gate, verifies no evidence, and
 * never blocks work because a gate was not run (`enforcement: "none"`). Nothing
 * about a project's scripts, paths, or evidence format is built in — every gate
 * comes from `.dsh/gates.yml`.
 *
 * All logic lives in `./host/`, which imports nothing from DSH; this module only
 * wires it to the harness tool registry. See the package README for the tool
 * contract, the config schema, and the token cost.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "tool-check-quality-gates";
/**
 * Only the tool registry is used. This package registers **no** system-prompt
 * section: the gate list is an on-demand lookup, not a rule worth paying for on
 * every request, so its resident prompt cost is zero.
 */
export declare const inject: string[];
export declare function apply(ctx: Context): void;

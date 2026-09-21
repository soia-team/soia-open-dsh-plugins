/**
 * `check_ui_size` — host tool that reports one UI element's **actual rendered**
 * size and the box styles that explain it, so a verification conclusion can cite
 * a measured number instead of a CSS declaration.
 *
 * The measurement itself lives in `./host/measure.ts` and imports nothing from
 * DSH; this module only wires it to the harness tool registry and contributes
 * one short system-prompt rule. See the package README for the tool contract,
 * the model-visible text, and the token cost.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "tool-check-ui-size";
/**
 * Both services are host-provided and must be ready before `apply` runs:
 * `tools` owns the registry this package registers into, and `systemPrompt`
 * owns the section registry it contributes to.
 */
export declare const inject: string[];
/**
 * Stable name of the prompt section this package owns: `tool:` plus the tool
 * name, which is the shape the official tool packages use (`dsh-tool-bash`
 * registers `tool:bash`). The kind prefix belongs to the package name, not to
 * the tool.
 */
export declare const CHECK_UI_SIZE_SECTION = "tool:check_ui_size";
/**
 * Placement in the assembled system prompt. Built-in tool guidance occupies
 * 1000–3100 and SDK tools start at 5000, so 3200 keeps this section next to the
 * other tool guidance. Equal orders are broken by section name, and a deployment
 * or agent preset can shadow this section by registering the same name.
 */
export declare const CHECK_UI_SIZE_SECTION_ORDER = 3200;
export declare function apply(ctx: Context): void;

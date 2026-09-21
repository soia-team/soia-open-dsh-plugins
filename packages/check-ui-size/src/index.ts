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
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { measureElement } from './host/measure.ts'

export const name = 'tool-check-ui-size'

/**
 * Both services are host-provided and must be ready before `apply` runs:
 * `tools` owns the registry this package registers into, and `systemPrompt`
 * owns the section registry it contributes to.
 */
export const inject = ['tools', 'systemPrompt']

/**
 * Stable name of the prompt section this package owns: `tool:` plus the tool
 * name, which is the shape the official tool packages use (`dsh-tool-bash`
 * registers `tool:bash`). The kind prefix belongs to the package name, not to
 * the tool.
 */
export const CHECK_UI_SIZE_SECTION = 'tool:check_ui_size'

/**
 * Placement in the assembled system prompt. Built-in tool guidance occupies
 * 1000–3100 and SDK tools start at 5000, so 3200 keeps this section next to the
 * other tool guidance. Equal orders are broken by section name, and a deployment
 * or agent preset can shadow this section by registering the same name.
 */
export const CHECK_UI_SIZE_SECTION_ORDER = 3200

/**
 * The model-facing rule this package adds, in English on purpose: this text is
 * paid for on every single request, and English costs roughly a third of what
 * the same content costs in Han characters under realistic tokenization. The
 * detailed acceptance procedure still belongs to the skill that is loaded on
 * demand, not to a section that is always resident.
 */
const GUIDANCE = [
  'UI acceptance needs a check_ui_size measurement, not declared CSS alone.',
  'On disagreement the measurement wins; name the layer (layout, font, box model, scroll).',
].join('\n')

/**
 * Model-facing tool description. States what it does and when to reach for it,
 * and deliberately stops there — usage instructions would be paid for on every
 * request, while the model can read the parameter schema for the rest.
 */
const TOOL_DESCRIPTION = 'Read one UI element\'s actual rendered size and box styles from a live page URL, '
  + 'to check whether declared CSS values match real geometry. Pass expectedHeight or expectedWidth to get '
  + 'signed differences. Returns status "error" with a code when the browser, the page, or the selector is unavailable.'

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'check_ui_size',
      description: TOOL_DESCRIPTION,
      parameters: {
        url: {
          type: 'string',
          required: true,
          description: 'Page URL to open, e.g. http://127.0.0.1:5173/',
        },
        selector: {
          type: 'string',
          required: true,
          description: 'CSS selector of the element to measure',
        },
        expectedHeight: {
          type: 'number',
          description: 'Expected height in CSS pixels, from a board or spec',
        },
        expectedWidth: {
          type: 'number',
          description: 'Expected width in CSS pixels, from a board or spec',
        },
      },
      output: {
        // Not model-facing: the harness sends only name/description/parameters.
        // Declared as one object carrying both variants, so a failure never has
        // to invent the measurement fields it could not read.
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', required: true },
            url: { type: 'string' },
            selector: { type: 'string' },
            measuredAt: { type: 'string' },
            matched: { type: 'integer' },
            visible: { type: 'boolean' },
            rect: {
              type: 'object',
              additionalProperties: false,
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
              },
            },
            computed: {
              type: 'object',
              additionalProperties: false,
              properties: {
                width: { type: 'number' },
                height: { type: 'number' },
                minWidth: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                minHeight: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                maxWidth: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                maxHeight: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                paddingTop: { type: 'number' },
                paddingBottom: { type: 'number' },
                fontSize: { type: 'number' },
                lineHeight: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                boxSizing: { type: 'string' },
                display: { type: 'string' },
              },
            },
            viewport: {
              type: 'object',
              additionalProperties: false,
              properties: {
                width: { type: 'integer' },
                height: { type: 'integer' },
              },
            },
            expected: {
              type: 'object',
              additionalProperties: false,
              properties: {
                width: { type: 'number' },
                height: { type: 'number' },
              },
            },
            diff: {
              type: 'object',
              additionalProperties: false,
              properties: {
                width: { type: 'number' },
                height: { type: 'number' },
              },
            },
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args) {
        const expected = args.expectedWidth === undefined && args.expectedHeight === undefined
          ? undefined
          : {
              ...(args.expectedWidth === undefined ? {} : { width: args.expectedWidth }),
              ...(args.expectedHeight === undefined ? {} : { height: args.expectedHeight }),
            }
        return await measureElement({
          url: args.url,
          selector: args.selector,
          ...(expected === undefined ? {} : { expected }),
        })
      },
    }),
  )

  ctx.systemPrompt.section({
    name: CHECK_UI_SIZE_SECTION,
    order: CHECK_UI_SIZE_SECTION_ORDER,
    text: GUIDANCE,
  })
}

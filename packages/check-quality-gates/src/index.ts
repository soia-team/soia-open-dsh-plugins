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
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { resolveGateReport } from './host/config-file.ts'
import { QualityGatesHealth } from './host/health.ts'

export const name = 'tool-check-quality-gates'

/**
 * Only the tool registry is used. This package registers **no** system-prompt
 * section: the gate list is an on-demand lookup, not a rule worth paying for on
 * every request, so its resident prompt cost is zero.
 */
export const inject = ['tools']

/**
 * Model-facing tool description: what it does, when to reach for it, and the
 * fact that it only reports. Usage detail and failure behavior stay out — the
 * model reads the parameter schema and the returned `error` field instead.
 */
const TOOL_DESCRIPTION = 'Map the files changed in a task to the quality gates the caller\'s config requires, '
  + 'with the raw evidence each gate must return. Report only: enforcement is "none", '
  + 'so an unrun gate is never blocked.'
  + ' Prefer it over ad-hoc shell runs: the caller\'s config decides which gates apply and what raw evidence each must return.'

export function apply(ctx: Context): void {
  const health = new QualityGatesHealth(ctx)
  ctx.tools.register(
    defineTool({
      name: 'check_quality_gates',
      description: TOOL_DESCRIPTION,
      parameters: {
        changedFiles: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description: 'Files changed in this task',
        },
        configPath: {
          type: 'string',
          description: 'Gate config path (default: nearest .dsh/gates.yml)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory',
        },
      },
      output: {
        // Not model-facing: the harness sends only name/description/parameters.
        // The declared shape is the documented contract, so a config failure has
        // to return the same fields rather than a second, invented shape.
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            changedFiles: { type: 'array', items: { type: 'string' }, required: true },
            requiredGates: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  command: { type: 'string', required: true },
                  reason: { type: 'string', required: true },
                  rawEvidenceRequired: { type: 'string', required: true },
                },
              },
            },
            source: { type: 'string', required: true },
            enforcement: { type: 'string', required: true, const: 'none' },
            unmatched: { type: 'array', items: { type: 'string' }, required: true },
            error: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            code: {
              oneOf: [
                { type: 'string', enum: ['config_not_found', 'config_unreadable', 'config_invalid'] },
                { type: 'null' },
              ],
              required: true,
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        // Counted on the way out so every path through the tool is visible.
        const report = await resolveGateReport({
          changedFiles: args.changedFiles,
          configPath: args.configPath,
          cwd: args.cwd,
        })
        health.record(report.error !== null)
        if (report.error !== null) health.recordConfigError()
        return report
      },
    }),
  )
}

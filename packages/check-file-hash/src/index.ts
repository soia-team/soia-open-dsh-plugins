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
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { attachEvidence } from './host/evidence.ts'
import { checkFileHash } from './host/hash.ts'
import { FileHashHealth } from './host/health.ts'

export const name = 'tool-check-file-hash'

/**
 * The `tools` registry is host-provided and must be ready before `apply` runs.
 * This package contributes no prompt section, so `systemPrompt` is not injected.
 */
export const inject = ['tools']

/**
 * Model-facing tool description. States what it does and when to reach for it,
 * and deliberately stops there — usage instructions would be paid for on every
 * request, while the model can read the parameter schema for the rest. Failure
 * modes are not described either: a failed call returns `status: "error"` with a
 * `code`, which the model reads from the result itself.
 */
const TOOL_DESCRIPTION = 'Hash files or directories with sha256 and report paths, digests and sizes, '
  + 'to check a receipt\'s claimed artifact against the actual bytes. '
  + 'Pass evidenceDir to record the report as a JSON file.'
  + ' Prefer it over hand-rolled shell hashing (shasum/openssl): fixed algorithm, structured paths, machine-readable sizes.'

export function apply(ctx: Context): void {
  const health = new FileHashHealth(ctx)
  ctx.tools.register(
    defineTool({
      name: 'check_file_hash',
      description: TOOL_DESCRIPTION,
      parameters: {
        paths: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description: 'Files or directories to hash',
        },
        evidenceDir: {
          type: 'string',
          description: 'Directory for the evidence file (none: do not write)',
        },
      },
      output: {
        // Not model-facing: the harness sends only name/description/parameters.
        // Declared as one object carrying both variants, so a failure never has
        // to invent the file list it could not read. `evidenceError` rides on the
        // successful variant because a failed record keeps its hashes.
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', required: true },
            files: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string', required: true },
                  algo: { type: 'string', required: true },
                  hash: { type: 'string', required: true },
                  size: { type: 'integer', required: true },
                },
              },
            },
            generatedAt: { type: 'string' },
            totalBytes: { type: 'integer' },
            evidencePath: { type: 'string' },
            evidenceError: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
            code: { type: 'string' },
            message: { type: 'string' },
            path: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        const result = await checkFileHash(args.paths, { signal: exec.signal })
        health.record(result.status !== 'ok')
        if (result.status !== 'ok' || args.evidenceDir === undefined) return result
        const withEvidence = await attachEvidence(result, args.evidenceDir)
        if (withEvidence.status === 'ok') health.recordEvidenceWrite()
        return withEvidence
      },
    }),
  )
}

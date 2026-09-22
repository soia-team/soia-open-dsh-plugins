/**
 * `check_skills` — host tool that audits one session log for whether the skills
 * a task required were actually loaded, and names which kind of failure it was
 * when they were not.
 *
 * The whole audit lives in `./host/` and imports nothing from DSH; this module
 * only wires it to the harness tool registry. See the package README for the
 * verdict criteria, the exact session-event shapes it reads, and the token cost.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { SessionReadError, loadSession } from './host/session.ts'
import {
  classifySession,
  collectSkillUsage,
  normalizeApplicableSkills,
  renderEvidenceReport,
  summarizeCatalog,
  writeEvidenceReport,
} from './host/skills.ts'
import type { CheckSkillsFailure, CheckSkillsOutcome } from './shared/types.ts'
import { SkillsHealth } from './host/health.ts'

export const name = 'tool-check-skills'

/** The host service this package registers into. */
export const inject = ['tools']

/**
 * Model-facing tool description. States what it does and when to reach for it,
 * and deliberately stops there: usage instructions would be paid for on every
 * request, and a failed call already returns `status: "error"` with a `code`,
 * so the failure modes do not need to be described here.
 */
const TOOL_DESCRIPTION = 'Audit a session log for whether the expected skills were loaded before the work '
  + 'started, and why not when they were not.'

/**
 * Turn a thrown reader code into the tool's error shape, so an unsupported Node
 * build or a missing session is a readable answer rather than a stack trace.
 * @param error - Whatever the audit threw.
 * @param sessionPath - Path being audited, when known.
 * @returns A typed failure result.
 */
function toFailure(error: unknown, sessionPath?: string): CheckSkillsFailure {
  if (error instanceof SessionReadError) {
    return {
      status: 'error',
      code: error.code,
      message: error.message,
      ...(error.sessionPath === undefined ? {} : { sessionPath: error.sessionPath }),
    }
  }
  return {
    status: 'error',
    code: 'session_unreadable',
    message: error instanceof Error ? error.message : String(error),
    ...(sessionPath === undefined ? {} : { sessionPath }),
  }
}

/**
 * Run one audit. Exported so tests can drive the real path without the registry.
 * @param options - Session path, expectation list and optional evidence directory.
 * @returns The audit result, or a typed failure.
 */
export function runCheckSkills(options: {
  sessionPath?: string
  applicableSkills?: string[]
  evidenceDir?: string
}): CheckSkillsOutcome {
  const applicableSkills = normalizeApplicableSkills(options.applicableSkills ?? [])

  let analysis
  try {
    analysis = loadSession(options.sessionPath)
  } catch (error) {
    return toFailure(error, options.sessionPath)
  }

  const evidence = collectSkillUsage(analysis)
  const classification = classifySession({
    catalog: evidence.catalog,
    loads: evidence.loads,
    applicableSkills,
  })
  const catalog = summarizeCatalog(evidence)

  const evidenceDir = options.evidenceDir?.trim()
  let evidencePath: string | undefined
  let evidenceError: string | undefined
  if (evidenceDir !== undefined && evidenceDir !== '') {
    const recordedAt = new Date().toISOString()
    try {
      evidencePath = writeEvidenceReport(evidenceDir, recordedAt, renderEvidenceReport({
        sessionPath: analysis.sessionPath,
        applicableSkills,
        verdict: classification.verdict,
        perSkill: classification.perSkill,
        catalog,
        calls: evidence.loads,
        missing: classification.missing,
        recordedAt,
      }))
    } catch (error) {
      // The audit already succeeded; only the optional report failed. Reporting
      // that as an error would throw away a valid verdict, so the verdict stands
      // and the reason is carried alongside it.
      evidenceError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    status: 'ok',
    task: {
      applicableSkills,
      source: applicableSkills.length === 0 ? 'none' : 'argument',
    },
    catalog,
    calls: evidence.loads,
    verdict: classification.verdict,
    missing: classification.missing,
    sessionPath: analysis.sessionPath,
    ...(evidencePath === undefined ? {} : { evidencePath }),
    ...(evidenceError === undefined ? {} : { evidenceError }),
  }
}

export function apply(ctx: Context): void {
  const health = new SkillsHealth(ctx)
  ctx.tools.register(
    defineTool({
      name: 'check_skills',
      description: TOOL_DESCRIPTION,
      parameters: {
        sessionPath: {
          type: 'string',
          description: 'Session log path; default: newest under $DSH_HOME/sessions',
        },
        applicableSkills: {
          type: 'array',
          items: { type: 'string' },
          description: 'Skill names expected for this task',
        },
        evidenceDir: {
          type: 'string',
          description: 'Directory for the optional markdown report',
        },
      },
      output: {
        // Not model-facing: the harness sends only name/description/parameters.
        // Declared as one object carrying both variants, so a failure never has
        // to invent the audit fields it could not read.
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', required: true },
            code: { type: 'string' },
            message: { type: 'string' },
            verdict: { type: 'string' },
            sessionPath: { type: 'string' },
            evidencePath: { type: 'string' },
            evidenceError: { type: 'string' },
            missing: { type: 'array', items: { type: 'string' } },
            task: {
              type: 'object',
              additionalProperties: false,
              properties: {
                applicableSkills: { type: 'array', items: { type: 'string' } },
                source: { type: 'string' },
              },
            },
            catalog: {
              type: 'object',
              additionalProperties: false,
              properties: {
                count: { type: 'integer' },
                names: { type: 'array', items: { type: 'string' } },
                present: { type: 'boolean' },
                called: { type: 'array', items: { type: 'string' } },
              },
            },
            calls: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string' },
                  turn: { type: 'integer' },
                  step: { type: 'integer' },
                  seq: { type: 'integer' },
                  ok: { type: 'boolean' },
                  reason: { type: 'string' },
                  error: { type: 'string' },
                  usedAfterLoad: { type: 'boolean' },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      // `async` is required by the tool contract even though every step here is
      // synchronous: file reads and zstd decoding are both blocking.
      async execute(args) {
        const report = await runCheckSkills({
          ...(args.sessionPath === undefined ? {} : { sessionPath: args.sessionPath }),
          ...(args.applicableSkills === undefined ? {} : { applicableSkills: args.applicableSkills }),
          ...(args.evidenceDir === undefined ? {} : { evidenceDir: args.evidenceDir }),
        })
        health.record(report.status !== 'ok')
        health.recordSessionRead(report.status === 'ok')
        return report
      },
    }),
  )
}

/**
 * Skill-usage classification: pure functions over decoded session events, plus
 * the evidence report.
 *
 * Nothing here touches the filesystem except {@link writeEvidenceFile}, and
 * nothing here calls DSH, so every rule in this module is testable from a
 * hand-built JSONL fixture.
 *
 * The five verdicts answer "was the right skill used, and if not, which kind of
 * failure is it". They are deliberately separable, because the fix differs:
 * `not_in_catalog` is an assembly problem, `not_attempted` and `wrong_pick` are
 * selection problems, and `loaded_not_effective` is a follow-through problem.
 * The exact predicate for each is stated in the package README; the conservative
 * ones (which refuse to accuse) are marked below.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type {
  CatalogSummary,
  SessionAnalysis,
  SessionEvent,
  SkillCatalog,
  SkillCatalogEntry,
  SkillLoadFailureReason,
  SkillLoadRecord,
  SkillUsageEvidence,
  SkillVerdict,
  SkillVerdictRecord,
} from '../shared/types.ts'

/** The official loader this audit keys on: `@deepseek-ai/dsh-tool-skill`. */
export const SKILL_TOOL_NAME = 'skill'

/**
 * The `user/message` source kind the loader publishes the catalog under. Only
 * this kind is read; the surrounding `<system-reminder>` prose is never parsed,
 * because the loader documents the durable entries as the fact and the prose as
 * a rendering.
 */
export const SKILL_CATALOG_SOURCE_KIND = 'skill-catalog'

/**
 * Source kind of a `/name` user-explicit injection. Documented but **not yet
 * consumed**: the loader injects the body directly for that gesture without
 * going through the `skill` tool, so a session driven purely by `/name` is
 * currently reported as `not_attempted`. See the README's Known Limitations.
 */
export const SKILL_INVOCATION_SOURCE_KIND = 'skill-invocation'

/** Mode bits for the evidence file: owner read/write only. */
const EVIDENCE_MODE = 0o600

/**
 * Worst-first ranking used to collapse per-skill verdicts into one overall
 * verdict. Assembly problems outrank selection problems, which outrank
 * follow-through problems; `ok` outranks nothing.
 */
const VERDICT_SEVERITY: Record<SkillVerdict, number> = {
  ok: 0,
  loaded_not_effective: 1,
  not_attempted: 2,
  wrong_pick: 3,
  not_in_catalog: 4,
  unreported: -1,
}

/** Read one field off an event's `data` bag without asserting its shape. */
function dataOf(event: SessionEvent): Record<string, unknown> {
  const data = event.data
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {}
}

/** Read a nested object field, or undefined when it is not a plain object. */
function objectField(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Read one catalog entry list off a `skill-catalog` source.
 *
 * An entry with a non-string or empty `name`, or a non-string `description`, is
 * enough to reject the whole record — the same posture the loader takes when it
 * decides whether a stored record is its own catalog. A rejected record is
 * skipped, and an older readable catalog stays the effective one.
 *
 * @param source - The message's `source` object.
 * @returns Readable entries, or undefined when the record is not usable.
 */
function readCatalogEntries(source: Record<string, unknown>): SkillCatalogEntry[] | undefined {
  const entries = source['entries']
  if (!Array.isArray(entries)) return undefined
  const readable: SkillCatalogEntry[] = []
  for (const entry of entries) {
    const record = objectField(entry)
    if (record === undefined) return undefined
    const name = record['name']
    const description = record['description']
    if (typeof name !== 'string' || name === '' || typeof description !== 'string') return undefined
    readable.push({ name, description })
  }
  return readable
}

/**
 * The session's effective skill catalog.
 *
 * The loader appends a complete replacement whenever the catalog changes, and an
 * empty replacement is an explicit retirement of earlier names, so the **last**
 * readable catalog event is the session's current catalog — never a union of
 * every catalog ever published.
 *
 * @param events - Decoded session events in log order.
 * @returns The effective catalog, with `present: false` when none was published.
 */
export function extractCatalog(events: readonly SessionEvent[]): SkillCatalog {
  const empty: SkillCatalog = { present: false, count: 0, names: [], entries: [] }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'user/message') continue
    const source = objectField(dataOf(event)['source'])
    if (source === undefined || source['kind'] !== SKILL_CATALOG_SOURCE_KIND) continue
    const entries = readCatalogEntries(source)
    if (entries === undefined) continue
    return {
      present: true,
      count: entries.length,
      names: entries.map((entry) => entry.name),
      entries,
    }
  }
  return empty
}

/** One `skill` call, before its result is paired in. */
interface RawCall {
  callId: string
  name: string
  seq?: number
  turn?: number
  step?: number
}

/** One parsed `arguments` payload of a `skill` call. */
interface CallArguments {
  name: string
}

/**
 * Read the `arguments` field of a `tool/call` event.
 *
 * The log stores arguments as a JSON **string**; an already-parsed object is
 * also accepted because the field is not schema-checked on read.
 *
 * @param raw - The event's raw `arguments` value.
 * @returns The parsed arguments, or undefined when they are unusable.
 */
function readCallArguments(raw: unknown): CallArguments | undefined {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  const record = objectField(parsed)
  if (record === undefined) return undefined
  const name = record['name']
  if (typeof name !== 'string' || name === '') return undefined
  return { name }
}

/**
 * Every `skill` tool call in the log, in call order.
 * @param events - Decoded session events.
 * @returns Calls that carry a usable skill name.
 */
function extractRawCalls(events: readonly SessionEvent[]): RawCall[] {
  const calls: RawCall[] = []
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const data = dataOf(event)
    if (data['name'] !== SKILL_TOOL_NAME) continue
    const callId = data['callId']
    if (typeof callId !== 'string' || callId === '') continue
    const args = readCallArguments(data['arguments'])
    if (args === undefined) continue
    calls.push({
      callId,
      name: args.name,
      ...(typeof event.seq === 'number' ? { seq: event.seq } : {}),
      ...(typeof data['turn'] === 'number' ? { turn: data['turn'] } : {}),
      ...(typeof data['step'] === 'number' ? { step: data['step'] } : {}),
    })
  }
  return calls
}

/** One `tool/result` event, reduced to what answers a call. */
interface RawResult {
  callId: string
  seq?: number
  isError: boolean
  errorText?: string
}

/**
 * First text block of a result's inner content, when it has one.
 * @param content - The `tool-result` block's `content` array.
 * @returns The text, or undefined when there is none.
 */
function firstResultText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    const record = objectField(block)
    if (record === undefined || record['type'] !== 'text') continue
    const text = record['text']
    if (typeof text === 'string') return text
  }
  return undefined
}

/**
 * Every tool result in the log, keyed for pairing with its call.
 *
 * A result row nests the model-facing message: the result block lives at
 * `data.message.content[0]` and its `toolCallId` is what ties it back to the
 * call. Error text is kept because a failed load is a different verdict input
 * from a load that never happened.
 *
 * @param events - Decoded session events.
 * @returns Results in log order.
 */
function extractRawResults(events: readonly SessionEvent[]): RawResult[] {
  const results: RawResult[] = []
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const message = objectField(dataOf(event)['message'])
    const content = message?.['content']
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const record = objectField(block)
      if (record === undefined || record['type'] !== 'tool-result') continue
      const callId = record['toolCallId']
      if (typeof callId !== 'string' || callId === '') continue
      const isError = record['isError'] === true
      const text = isError ? firstResultText(record['content']) : undefined
      results.push({
        callId,
        isError,
        ...(typeof event.seq === 'number' ? { seq: event.seq } : {}),
        ...(text === undefined ? {} : { errorText: text }),
      })
    }
  }
  return results
}

/**
 * Distinct tool names called anywhere in the log, in call order.
 * @param events - Decoded session events.
 * @returns Tool names, excluding `skill` itself.
 */
export function extractToolNames(events: readonly SessionEvent[]): string[] {
  const names: string[] = []
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const name = dataOf(event)['name']
    if (typeof name !== 'string' || name === '') continue
    // The loader is infrastructure, not evidence that a skill was applied.
    if (name === SKILL_TOOL_NAME) continue
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/**
 * One row per distinct skill the session called, carrying the latest attempt.
 *
 * A skill loaded twice is one record: the later call is the one whose
 * follow-through decides `loaded_not_effective`, and mixing an early empty load
 * with a later productive one would accuse the session wrongly.
 *
 * @param events - Decoded session events.
 * @returns Load records in first-call order.
 */
export function extractSkillLoads(events: readonly SessionEvent[]): SkillLoadRecord[] {
  const calls = extractRawCalls(events)
  const results = extractRawResults(events)
  const resultsByCallId = new Map(results.map((result) => [result.callId, result]))

  /** Sequence numbers of non-`skill` tool calls, for the follow-through test. */
  const otherCallSeqs: number[] = []
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    if (dataOf(event)['name'] === SKILL_TOOL_NAME) continue
    if (typeof event.seq === 'number') otherCallSeqs.push(event.seq)
  }

  const order: string[] = []
  const latest = new Map<string, SkillLoadRecord>()
  for (const call of calls) {
    const result = resultsByCallId.get(call.callId)
    let ok = false
    let reason: SkillLoadFailureReason | undefined = 'no_result'
    let error: string | undefined
    if (result !== undefined) {
      ok = !result.isError
      reason = ok ? undefined : 'call_failed'
      if (!ok) error = result.errorText ?? 'skill call failed'
    }

    // Conservative by construction: only a later *non-skill* tool call counts as
    // follow-through. Further skill loads prove nothing about this skill, and a
    // failed load can never be "used".
    const seq = call.seq
    const usedAfterLoad = ok
      && seq !== undefined
      && otherCallSeqs.some((other) => other > seq)

    const record: SkillLoadRecord = {
      name: call.name,
      ...(call.turn === undefined ? {} : { turn: call.turn }),
      ...(call.step === undefined ? {} : { step: call.step }),
      ...(call.seq === undefined ? {} : { seq: call.seq }),
      ok,
      ...(reason === undefined ? {} : { reason }),
      ...(error === undefined ? {} : { error }),
      usedAfterLoad,
    }

    if (!latest.has(call.name)) order.push(call.name)
    latest.set(call.name, record)
  }
  return order.flatMap((name) => {
    const record = latest.get(name)
    return record === undefined ? [] : [record]
  })
}

/**
 * Every derived fact the audit needs from one session log.
 * @param analysis - A decoded session artifact.
 * @returns Catalog, load records, called skills and observed tool names.
 */
export function collectSkillUsage(analysis: SessionAnalysis): SkillUsageEvidence {
  const loads = extractSkillLoads(analysis.events)
  return {
    catalog: extractCatalog(analysis.events),
    loads,
    calledSkills: loads.map((load) => load.name),
    toolNames: extractToolNames(analysis.events),
  }
}

/**
 * Normalise a caller-supplied skill list.
 *
 * Blank entries are dropped, surrounding whitespace is trimmed, and duplicates
 * are collapsed keeping first-seen order, so a repeated name cannot produce two
 * verdict rows for one expectation.
 *
 * @param names - Raw caller input.
 * @returns The cleaned list.
 */
export function normalizeApplicableSkills(names: readonly string[]): string[] {
  const cleaned: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (name === '' || cleaned.includes(name)) continue
    cleaned.push(name)
  }
  return cleaned
}

/** Input of one classification pass. */
export interface ClassifyInput {
  catalog: SkillCatalog
  loads: readonly SkillLoadRecord[]
  applicableSkills: readonly string[]
}

/** Classification of one session against one expectation list. */
export interface Classification {
  verdict: SkillVerdict
  perSkill: SkillVerdictRecord[]
  missing: string[]
}

/**
 * Classify one expected skill.
 *
 * Order matters and is deliberate: `not_in_catalog` is decided first, because a
 * skill that was never offered cannot fairly be reported as "not attempted" —
 * that would blame the model for an assembly problem.
 *
 * @param name - The expected skill name.
 * @param input - Catalog, load records and the expectation list.
 * @returns `ok`, `not_in_catalog`, `not_attempted`, `wrong_pick` or
 * `loaded_not_effective`.
 */
export function classifySkill(name: string, input: ClassifyInput): SkillVerdict {
  const inCatalog = input.catalog.present && input.catalog.names.includes(name)
  if (!inCatalog) return 'not_in_catalog'

  const load = input.loads.find((record) => record.name === name)
  if (load === undefined) {
    const calledAnything = input.loads.length > 0
    return calledAnything ? 'wrong_pick' : 'not_attempted'
  }
  // A load that failed produced no instructions, so the skill was never
  // successfully loaded; reporting that as "never attempted" is the honest read.
  if (!load.ok) return 'not_attempted'
  // Every other outcome is `ok`. Refusing to accuse is the point: the only
  // accusation this audit makes is the one the log proves outright — the load
  // happened and nothing followed it. See the README for the exact predicate.
  return load.usedAfterLoad ? 'ok' : 'loaded_not_effective'
}

/**
 * Classify every expected skill and collapse the results into one verdict.
 *
 * A skill that was called and whose instructions were followed counts as `ok`
 * even when `usedAfterLoad` is false, provided something else in the session
 * shows work continuing — the overall verdict is the worst per-skill verdict,
 * so one bad expectation is never hidden by a good one.
 *
 * @param input - Catalog, load records and the expectation list.
 * @returns The overall verdict, per-skill rows and the missing names.
 */
export function classifySession(input: ClassifyInput): Classification {
  if (input.applicableSkills.length === 0) {
    return { verdict: 'unreported', perSkill: [], missing: [] }
  }
  const perSkill: SkillVerdictRecord[] = input.applicableSkills.map((name) => ({
    name,
    verdict: classifySkill(name, input),
  }))
  let verdict: SkillVerdict = 'ok'
  for (const record of perSkill) {
    if (VERDICT_SEVERITY[record.verdict] > VERDICT_SEVERITY[verdict]) verdict = record.verdict
  }
  return {
    verdict,
    perSkill,
    missing: perSkill.filter((record) => record.verdict !== 'ok').map((record) => record.name),
  }
}

/**
 * The catalog slice of the result.
 * @param evidence - Collected session evidence.
 * @returns Count, names, whether a catalog was published, and what was called.
 */
export function summarizeCatalog(evidence: SkillUsageEvidence): CatalogSummary {
  return {
    count: evidence.catalog.count,
    names: [...evidence.catalog.names],
    present: evidence.catalog.present,
    called: [...evidence.calledSkills],
  }
}

/** One rendered row of the evidence report. */
export interface EvidenceReportInput {
  sessionPath: string
  applicableSkills: readonly string[]
  verdict: SkillVerdict
  perSkill: readonly SkillVerdictRecord[]
  catalog: CatalogSummary
  calls: readonly SkillLoadRecord[]
  missing: readonly string[]
  recordedAt: string
}

/**
 * Render the optional markdown evidence report.
 * @param input - Everything the audit concluded.
 * @returns Markdown text.
 */
export function renderEvidenceReport(input: EvidenceReportInput): string {
  const lines: string[] = [
    '# Skill usage audit',
    '',
    `- Session: \`${input.sessionPath}\``,
    `- Recorded: ${input.recordedAt}`,
    `- Verdict: \`${input.verdict}\``,
    `- Expected: ${input.applicableSkills.length === 0 ? '(none reported)' : input.applicableSkills.map((name) => `\`${name}\``).join(', ')}`,
    `- Catalog: ${input.catalog.present ? `${input.catalog.count} skill(s)` : 'no catalog event in this session'}`,
    `- Missing: ${input.missing.length === 0 ? '(none)' : input.missing.map((name) => `\`${name}\``).join(', ')}`,
    '',
    '## Per skill',
    '',
  ]

  if (input.perSkill.length === 0) {
    lines.push('No expectation list was provided, so nothing can be classified.', '')
  } else {
    lines.push('| Skill | Verdict | In catalog | Loaded | Follow-through |', '|---|---|---|---|---|')
    for (const record of input.perSkill) {
      const load = input.calls.find((call) => call.name === record.name)
      const loaded = load === undefined ? 'no' : (load.ok ? 'yes' : `failed (${load.reason ?? 'unknown'})`)
      const followThrough = load === undefined || !load.ok
        ? '—'
        : (load.usedAfterLoad ? 'yes' : 'none')
      lines.push(
        `| \`${record.name}\` | \`${record.verdict}\` | ${input.catalog.names.includes(record.name) ? 'yes' : 'no'} | ${loaded} | ${followThrough} |`,
      )
    }
    lines.push('')
  }

  lines.push('## Skill calls in this session', '')
  if (input.calls.length === 0) {
    lines.push('The session called the `skill` tool zero times.', '')
  } else {
    lines.push('| Skill | Result | Turn | Step | Note |', '|---|---|---|---|---|')
    for (const call of input.calls) {
      const result = call.ok ? 'ok' : `\`${call.reason ?? 'failed'}\``
      const note = call.error === undefined
        ? (call.usedAfterLoad ? 'work continued after this load' : 'no later tool call')
        : call.error.replaceAll('|', '\\|')
      lines.push(
        `| \`${call.name}\` | ${result} | ${call.turn ?? '—'} | ${call.step ?? '—'} | ${note} |`,
      )
    }
    lines.push('')
  }

  lines.push(
    '## Verdict criteria',
    '',
    '- `ok` — expected, in the catalog, loaded successfully.',
    '- `not_in_catalog` — not offered by the session catalog (assembly problem).',
    '- `not_attempted` — offered, but no successful `skill` call for it.',
    '- `wrong_pick` — offered and not called, while another skill was called.',
    '- `loaded_not_effective` — loaded, but no later non-`skill` tool call follows it.',
    '- `unreported` — the caller supplied no expectation list.',
    '',
  )
  return lines.join('\n')
}

/**
 * Write the evidence report atomically: a private temporary file in the target
 * directory, then a rename onto the final name. A rename within one directory is
 * atomic, so a reader never observes a partial report, and the temporary file is
 * removed on every failure path so no stray file is left behind.
 *
 * @param dir - Target directory, created when missing.
 * @param recordedAt - ISO timestamp used in the file name.
 * @param text - Report body.
 * @returns Absolute path of the written report.
 */
export function writeEvidenceReport(dir: string, recordedAt: string, text: string): string {
  mkdirSync(dir, { recursive: true })
  const stamp = recordedAt.replaceAll(':', '').replaceAll('.', '')
  const target = join(dir, `skill-usage-${stamp}.md`)
  const temporary = `${target}.tmp`
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', mode: EVIDENCE_MODE })
    renameSync(temporary, target)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
  return target
}

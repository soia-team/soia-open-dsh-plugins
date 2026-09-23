#!/usr/bin/env node
/**
 * Replay real session traffic through the shipped policy rules.
 *
 * The rule corpus proves the rules behave on the commands their author thought
 * of. This measures them against the commands a model actually ran on this
 * machine — which is where both shipped false positives originally came from,
 * and where a rule that is "correct" but useless shows up as noise.
 *
 * It is offline and free: session logs are read, no model is called. Output is
 * a summary plus redacted samples per rule, because deciding whether a hit is a
 * false positive needs a human reading the command, and the command may contain
 * a credential.
 *
 * Usage:
 *   node scripts/policy-replay.mts [--sessions <dir>] [--samples <n>] [--json <path>]
 *
 * Exit codes: 0 always — this measures, it does not gate.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { evaluateCall } from '../packages/safe-tool-call-policy/src/shared/evaluate.ts'
import type { PolicyRule } from '../packages/safe-tool-call-policy/src/shared/types.ts'

const args = process.argv.slice(2)
const argOf = (flag: string, fallback: string): string => {
  const index = args.indexOf(flag)
  return index === -1 ? fallback : (args[index + 1] ?? fallback)
}
const sessionRoot = argOf('--sessions', join(homedir(), '.dsh', 'sessions'))
const sampleCount = Number(argOf('--samples', '6'))
const jsonPath = args.includes('--json') ? argOf('--json', '/tmp/policy-replay.json') : undefined

const RULES: readonly PolicyRule[] = JSON.parse(
  readFileSync(new URL('../packages/safe-tool-call-policy/danger-patterns.json', import.meta.url), 'utf8'),
) as PolicyRule[]

/** Frames in a `session.v3.jsonl.zstd`: the file is concatenated zstd frames. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Decode every zstd frame in a session file.
 *
 * `zstdDecompressSync` decodes one frame, and these files hold many, so the
 * buffer is split on the frame magic first.
 * @param file - absolute path to the session file.
 * @returns the concatenated decompressed text.
 */
function decodeSession(file: string): string {
  const raw = readFileSync(file)
  const starts: number[] = []
  for (let index = 0; index <= raw.length - ZSTD_MAGIC.length; index += 1) {
    if (raw.compare(ZSTD_MAGIC, 0, ZSTD_MAGIC.length, index, index + ZSTD_MAGIC.length) === 0) starts.push(index)
  }
  const frames = starts.length === 0 ? [raw] : starts.map((start, i) => raw.subarray(start, starts[i + 1] ?? raw.length))
  return frames.map((frame) => zstdDecompressSync(frame).toString('utf8')).join('')
}

/**
 * Pull every JSON record out of a decoded session.
 *
 * Later generations of these files leave no newline between records, so a plain
 * line split is not enough: a line that does not parse is scanned for object
 * boundaries instead of being dropped.
 * @param text - decoded session text.
 * @returns parsed records.
 */
function recordsOf(text: string): unknown[] {
  const records: unknown[] = []
  const push = (candidate: string): void => {
    const trimmed = candidate.trim()
    if (trimmed === '') return
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      // Concatenated objects: walk braces and take each balanced span.
      let depth = 0
      let start = -1
      for (let index = 0; index < trimmed.length; index += 1) {
        const char = trimmed[index]
        if (char === '{') {
          if (depth === 0) start = index
          depth += 1
        } else if (char === '}') {
          depth -= 1
          if (depth === 0 && start !== -1) {
            try {
              records.push(JSON.parse(trimmed.slice(start, index + 1)))
            } catch {
              // A malformed span is skipped; the summary counts what parsed.
            }
            start = -1
          }
        }
      }
    }
  }
  for (const line of text.split('\n')) push(line)
  return records
}

/**
 * Mask anything that looks like a credential.
 *
 * This script reads commands a model ran on a real machine, and some of them
 * carried tokens (the policy's own secret rule exists because of that). Samples
 * are for judging rule quality, not for reading secrets, so values are masked
 * before they are printed or written.
 * @param command - raw command text.
 * @returns the command with credential-shaped values replaced.
 */
function redact(command: string): string {
  return command
    .replace(/([Aa]uthorization\s*:\s*\S+\s+)\S+/g, '$1***')
    .replace(/\b(sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g, '$1***')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{3,}/g, '***JWT***')
    .replace(/(\s-p)([A-Za-z0-9!@#$%^&*_+]{8,})/g, '$1***')
    .replace(/((?:token|api[-_]?key|password|passwd|secret)\s*[=:]\s*)\S+/gi, '$1***')
}

/** Walk a directory tree, yielding files that match a predicate. */
function* walk(dir: string, match: (name: string) => boolean): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry)
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (stat.isDirectory()) yield* walk(path, match)
    else if (match(entry)) yield path
  }
}

interface Observation {
  session: string
  command: string
}

const observations: Observation[] = []
let sessionCount = 0
for (const file of walk(sessionRoot, (name) => name.startsWith('session') && name.endsWith('.zstd'))) {
  sessionCount += 1
  let text: string
  try {
    text = decodeSession(file)
  } catch {
    continue
  }
  for (const record of recordsOf(text)) {
    const event = record as { type?: string, data?: { name?: string, arguments?: unknown } }
    if (event.type !== 'tool/call' || event.data?.name !== 'bash') continue
    const raw = event.data.arguments
    let command: string | undefined
    if (typeof raw === 'string') {
      try {
        command = (JSON.parse(raw) as { command?: string }).command
      } catch {
        command = undefined
      }
    } else if (typeof raw === 'object' && raw !== null) {
      command = (raw as { command?: string }).command
    }
    if (typeof command === 'string' && command.trim() !== '') observations.push({ session: file, command })
  }
}

const unique = new Map<string, Observation>()
for (const observation of observations) if (!unique.has(observation.command)) unique.set(observation.command, observation)

const byRule = new Map<string, { asked: number, denied: number, samples: string[], matches: Map<string, number> }>()
let quiet = 0
for (const command of unique.values()) {
  const decision = evaluateCall({ tool: 'bash', text: command.command }, RULES)
  if (decision.ruleId === undefined) {
    quiet += 1
    continue
  }
  const bucket = byRule.get(decision.ruleId) ?? { asked: 0, denied: 0, samples: [], matches: new Map<string, number>() }
  if (decision.action === 'deny') bucket.denied += 1
  else bucket.asked += 1
  const rule = RULES.find((candidate) => candidate.id === decision.ruleId)
  const matched = rule === undefined ? null : new RegExp(rule.pattern, 'g').exec(command.command)
  const key = matched === null ? '(no text)' : redact(matched[0]).slice(0, 60)
  bucket.matches.set(key, (bucket.matches.get(key) ?? 0) + 1)
  if (bucket.samples.length < sampleCount) {
    bucket.samples.push(`${redact(command.command).replace(/\n/g, ' ').slice(0, 120)}    ⟵ 命中: ${key}`)
  }
  byRule.set(decision.ruleId, bucket)
}

console.log('真实流量回放 —— 把历史会话里的 bash 命令喂给已发布的规则\n')
console.log(`扫描会话 ${sessionCount} 个 · bash 调用 ${observations.length} 次 · 去重后 ${unique.size} 条`)
const flagged = [...byRule.values()].reduce((sum, bucket) => sum + bucket.asked + bucket.denied, 0)
console.log(`放行 ${quiet} 条 · 命中 ${flagged} 条（占 ${unique.size === 0 ? 0 : Math.round((flagged / unique.size) * 100)}%）\n`)
for (const [ruleId, bucket] of [...byRule].toSorted((a, b) => (b[1].asked + b[1].denied) - (a[1].asked + a[1].denied))) {
  const rule = RULES.find((candidate) => candidate.id === ruleId)
  console.log(`${ruleId}（${rule?.action ?? '?'}）: ${bucket.asked + bucket.denied} 条`)
  const top = [...bucket.matches].toSorted((a, b) => b[1] - a[1]).slice(0, 5)
  for (const [text, count] of top) console.log(`    命中片段 ×${count}: ${text}`)
  for (const sample of bucket.samples) console.log(`    · ${sample.slice(0, 150)}`)
}
console.log('\n判读提示：命中里有多少是误报，需要人工看样本——规则正确但吵，等于让人关掉它。')
console.log('样本已脱敏（凭据形状的值替换为 ***）。')

if (jsonPath !== undefined) {
  writeFileSync(jsonPath, `${JSON.stringify({
    sessions: sessionCount,
    calls: observations.length,
    unique: unique.size,
    quiet,
    byRule: Object.fromEntries([...byRule].map(([id, bucket]) => [id, {
      asked: bucket.asked,
      denied: bucket.denied,
      matches: Object.fromEntries(bucket.matches),
      samples: bucket.samples,
    }])),
  }, null, 2)}\n`)
  console.log(`证据写入 ${jsonPath}`)
}

/**
 * Optional decision journal.
 *
 * Counters answer "how often"; a journal answers "which command, when, and by
 * which rule" — the difference between knowing a policy is noisy and being able
 * to reproduce it. It is off by default and enabled with
 * `SOIA_POLICY_JOURNAL=/path/to/policy.jsonl`, because it records commands, and
 * commands can carry credentials.
 *
 * Every line is redacted before writing: values that look like tokens are masked,
 * so the journal can be shared while diagnosing.
 *
 * @module safe-tool-call-policy/host/decisions
 */
import { appendFileSync } from 'node:fs'

/** One journalled decision. */
export interface DecisionRecord {
  /** Epoch milliseconds. */
  readonly at: number
  /** The rule that decided the call. */
  readonly ruleId: string
  /** Tool the call was made with. */
  readonly tool: string
  /** Action taken (after any downgrade for a session that cannot ask). */
  readonly action: string
  /** True when the rule fired but could only be reported. */
  readonly downgraded: boolean
  /** First 160 characters of the command, redacted. */
  readonly excerpt: string
}

/**
 * Mask credential-shaped values.
 * @param text - raw text.
 * @returns the text with such values replaced.
 */
export function redact(text: string): string {
  return text
    .replace(/([Aa]uthorization\s*:\s*\S+\s+)\S+/g, '$1***')
    .replace(/\b(sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g, '$1***')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{3,}/g, '***JWT***')
    .replace(/(\s-p)([A-Za-z0-9!@#$%^&*_+]{8,})/g, '$1***')
    .replace(/((?:token|api[-_]?key|password|passwd|secret)\s*[=:]\s*)\S+/gi, '$1***')
}

/**
 * Append one decision to the journal when it is enabled.
 * @param record - the decision to record.
 * @param path - journal path; absent means journalling is off.
 */
export function journalDecision(record: DecisionRecord, path: string | undefined): void {
  if (path === undefined || path === '') return
  try {
    appendFileSync(path, `${JSON.stringify({ ...record, excerpt: redact(record.excerpt) })}\n`)
  } catch {
    // Diagnosis must never break enforcement: a journal that cannot be written
    // is a lost record, not a failed call.
  }
}

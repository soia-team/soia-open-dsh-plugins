/**
 * A deliberately small YAML reader for the project policy document.
 *
 * A full YAML parser is a dependency this package does not need: the policy
 * document has exactly one shape, so the reader implements exactly that shape
 * and refuses everything else by throwing {@link PolicyConfigError} — and a
 * refused document fails open with a note instead of half-applying.
 *
 * Supported:
 *
 * ```yaml
 * # full-line comment
 * disable:                 # a block sequence of scalars
 *   - rule-id
 *   - other-rule-id
 * rules:                   # a block sequence of flat mappings
 *   - id: my-rule
 *     tool: bash
 *     pattern: "psql .*prod"   # plain, 'single', or "double" quoted scalar
 *     action: ask
 *     reason: Touches production.
 *     remedy: Use the staging DSN.
 *     source: project
 * ```
 *
 * Also accepted: blank lines, trailing `# comment` after whitespace outside
 * quotes, one level of `- ` nesting as above, and a flow sequence written as
 * JSON (`disable: ["a", "b"]`) or as a bare comma list (`disable: [a, b]`).
 *
 * Refused on purpose: tabs in indentation, nested mappings other than the one
 * `rules:` item level, block scalars (`|`, `>`), anchors and aliases (`&`, `*`),
 * tags (`!`), multiple documents (`---`), and duplicate keys. JSON is a subset
 * of this grammar, so a JSON policy body parses here too.
 *
 * @module safe-tool-call-policy/yaml-subset
 */
import { PolicyConfigError } from './config-error.ts'

/** One significant line: comments and blanks already removed. */
interface SignificantLine {
  /** 1-based source line number, for error messages a reader can act on. */
  readonly number: number
  /** Number of leading spaces; tabs are rejected before this is computed. */
  readonly indent: number
  /** Line content from the first non-space character, trailing comment removed. */
  readonly text: string
}

/** Keys of the policy document; anything else is reported, not guessed. */
const TOP_LEVEL_KEYS = new Set(['rules', 'disable'])

/** Plain scalars may not begin with a YAML indicator this reader does not implement. */
const UNSUPPORTED_SCALAR_START = new Set(['&', '*', '!', '|', '>', '{', '}', '%', '@', '`'])

/** A key this reader accepts: simple, unquoted, no spaces. */
const KEY_PATTERN = /^[A-Za-z_][\w-]*$/

/** Whether one line starts a `- ` sequence item. */
function isSequenceItem(text: string): boolean {
  return text === '-' || text.startsWith('- ')
}

/** Remove a trailing `# comment` that starts outside quotes and after whitespace. */
function stripComment(line: string): string {
  let quote: '"' | "'" | undefined

  for (let index = 0; index < line.length; index++) {
    const character = line[index]

    if (quote === '"') {
      if (character === '\\') index++
      else if (character === '"') quote = undefined
      continue
    }

    if (quote === "'") {
      if (character !== "'") continue
      if (line[index + 1] === "'") index++
      else quote = undefined
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      continue
    }

    if (character === '#' && (index === 0 || /\s/.test(line[index - 1] ?? ''))) {
      return line.slice(0, index)
    }
  }

  return line
}

/** Split the document into significant lines, rejecting tab indentation. */
function readSignificantLines(text: string): SignificantLine[] {
  const lines: SignificantLine[] = []
  const raw = text.split('\n')

  for (const [index, rawLine] of raw.entries()) {
    const line = stripComment(rawLine.replace(/\r$/, ''))
    const content = line.trimStart()
    const indent = line.length - content.length

    if (content.length === 0) continue

    const indentation = line.slice(0, indent)

    if (indentation.includes('\t')) {
      throw new PolicyConfigError(`line ${index + 1}: tab in indentation; use spaces`)
    }

    lines.push({ number: index + 1, indent, text: content })
  }

  return lines
}

/** Read a quoted or plain scalar, or a flow sequence, from one value fragment. */
function parseValue(fragment: string, line: number): unknown {
  const value = fragment.trim()

  if (value.length === 0) throw new PolicyConfigError(`line ${line}: missing value`)

  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)

      if (typeof parsed !== 'string') throw new Error('not a string')

      return parsed
    } catch {
      throw new PolicyConfigError(`line ${line}: invalid double-quoted string`)
    }
  }

  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      throw new PolicyConfigError(`line ${line}: unterminated single-quoted string`)
    }

    return value.slice(1, -1).replaceAll("''", "'")
  }

  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new PolicyConfigError(`line ${line}: unterminated flow sequence`)

    const body = value.slice(1, -1).trim()

    if (body.length === 0) return []

    try {
      const parsed: unknown = JSON.parse(value)

      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed
    } catch {
      // A bare comma list is not JSON; the fallback below reads it as strings.
    }

    return body.split(',').map((item) => item.trim().replace(/^(['"])(.*)\1$/, '$2'))
  }

  if (UNSUPPORTED_SCALAR_START.has(value[0] ?? '')) {
    throw new PolicyConfigError(
      `line ${line}: value starts with "${value[0]}", which this reader does not implement; quote the value`,
    )
  }

  if (value.includes(': ')) {
    throw new PolicyConfigError(`line ${line}: plain value contains ": "; quote the value`)
  }

  return value
}

/** Split `key: value` at the first colon that ends the key, or return undefined. */
function splitKey(text: string): { key: string, value: string } | undefined {
  const colon = text.indexOf(':')

  if (colon < 0) return undefined

  const key = text.slice(0, colon)
  const rest = text.slice(colon + 1)

  if (!KEY_PATTERN.test(key)) return undefined

  if (rest.length > 0 && !rest.startsWith(' ')) return undefined

  return { key, value: rest.trim() }
}

/** Read one block sequence starting at `start`, returning its items and the next index. */
function parseBlockSequence(
  lines: readonly SignificantLine[],
  start: number,
  ownerKey: string,
): { items: unknown[], next: number } {
  const items: unknown[] = []
  let index = start
  let itemIndent: number | undefined

  while (index < lines.length) {
    const line = lines[index]

    if (line === undefined || line.indent === 0) break

    if (itemIndent === undefined) itemIndent = line.indent

    if (line.indent !== itemIndent) {
      throw new PolicyConfigError(
        `line ${line.number}: sequence item under "${ownerKey}" is indented differently from the first item`,
      )
    }

    if (!isSequenceItem(line.text)) {
      throw new PolicyConfigError(`line ${line.number}: expected a "- " sequence item under "${ownerKey}"`)
    }

    const itemText = line.text === '-' ? '' : line.text.slice(2)
    const head = splitKey(itemText)

    if (head === undefined) {
      if (itemText.trim().length === 0) {
        throw new PolicyConfigError(`line ${line.number}: empty sequence item under "${ownerKey}"`)
      }

      items.push(parseValue(itemText, line.number))
      index++

      const next = lines[index]

      if (next !== undefined && next.indent > (itemIndent ?? 0) && !isSequenceItem(next.text)) {
        throw new PolicyConfigError(
          `line ${next.number}: a scalar sequence item under "${ownerKey}" cannot have nested content`,
        )
      }

      continue
    }

    // A mapping item: its remaining keys sit at the column where this key starts.
    const keyColumn = (itemIndent ?? 0) + 2
    const item: Record<string, unknown> = {}
    let cursor: SignificantLine | undefined = line
    let cursorIndex = index
    let first = true

    while (cursor !== undefined) {
      const entry = first ? head : splitKey(cursor.text)

      if (entry === undefined) {
        throw new PolicyConfigError(`line ${cursor.number}: expected "key: value" in a "${ownerKey}" item`)
      }

      if (Object.hasOwn(item, entry.key)) {
        throw new PolicyConfigError(`line ${cursor.number}: duplicate key "${entry.key}"`)
      }

      item[entry.key] = parseValue(entry.value, cursor.number)
      cursorIndex++
      cursor = lines[cursorIndex]
      first = false

      if (cursor === undefined || cursor.indent !== keyColumn) break

      if (isSequenceItem(cursor.text)) {
        throw new PolicyConfigError(`line ${cursor.number}: unexpected sequence item inside a mapping item`)
      }
    }

    items.push(item)
    index = cursorIndex
  }

  return { items, next: index }
}

/**
 * Parse the policy document subset.
 *
 * @param text - the raw file content.
 * @returns one object per top-level key; keys outside `rules`/`disable` are
 *   still returned so the caller can report them.
 * @throws {PolicyConfigError} when the text is not inside the supported subset.
 */
export function parseYamlSubset(text: string): Record<string, unknown> {
  const lines = readSignificantLines(text)
  const document: Record<string, unknown> = {}
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (line === undefined) break

    if (line.indent !== 0) {
      throw new PolicyConfigError(`line ${line.number}: unexpected indentation at the top level`)
    }

    const entry = splitKey(line.text)

    if (entry === undefined) {
      throw new PolicyConfigError(`line ${line.number}: expected "key: value" at the top level`)
    }

    if (Object.hasOwn(document, entry.key)) {
      throw new PolicyConfigError(`line ${line.number}: duplicate key "${entry.key}"`)
    }

    if (entry.value.length > 0) {
      if (entry.value === '|' || entry.value === '>') {
        throw new PolicyConfigError(`line ${line.number}: block scalars are not supported; quote the value`)
      }

      document[entry.key] = parseValue(entry.value, line.number)
      index++
      continue
    }

    const sequence = parseBlockSequence(lines, index + 1, entry.key)

    if (sequence.items.length === 0) {
      throw new PolicyConfigError(`line ${line.number}: "${entry.key}" has no value and no block sequence`)
    }

    document[entry.key] = sequence.items
    index = sequence.next
  }

  return document
}

/** Top-level keys this reader knows; the caller reports the rest as notes. */
export { TOP_LEVEL_KEYS }

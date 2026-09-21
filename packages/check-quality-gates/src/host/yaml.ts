/**
 * Minimal YAML subset parser for the gate config file.
 *
 * The package ships no runtime dependency and no host parser may be pulled in,
 * so this module implements exactly the subset the documented config schema
 * needs: block mappings, block sequences, `- key: value` items, flow sequences
 * of scalars, quoted and plain scalars, comments, blank lines, and one optional
 * leading `---`.
 *
 * Everything outside that subset is **rejected with a readable message and the
 * 1-based line number** instead of being guessed at: tabs in indentation,
 * anchors, aliases, tags, directives, block scalars (`|`, `>`), flow mappings,
 * nested flow collections, multi-line plain scalars, and duplicate keys. A
 * config this parser does not understand must never silently produce a wrong
 * gate list.
 */

/** One scalar value in the supported subset. */
export type YamlScalar = string | number | boolean | null

/** One parsed value in the supported subset. */
export type YamlValue = YamlScalar | YamlValue[] | { [key: string]: YamlValue }

/** Syntax failure in the supported subset, carrying the 1-based source line. */
export class YamlError extends Error {
  /** 1-based line the failure was found on. */
  readonly line: number

  constructor(message: string, line: number) {
    super(`${message} (line ${line})`)
    this.name = 'YamlError'
    this.line = line
  }
}

/** One content line after comment stripping, with its indentation measured. */
interface SourceLine {
  readonly number: number
  readonly indent: number
  readonly content: string
}

/** One `key: value` pair; `value` is undefined when the value is a nested block. */
interface Entry {
  readonly key: string
  readonly value: string | undefined
}

/** Escape sequences this parser understands inside a double-quoted scalar. */
const DOUBLE_QUOTE_ESCAPES: Record<string, string> = {
  '\\': '\\',
  '"': '"',
  '/': '/',
  '0': '\0',
  n: '\n',
  r: '\r',
  t: '\t',
}

/** Leading characters that mark YAML features outside the supported subset. */
const UNSUPPORTED_LEAD = new Set(['&', '*', '!', '|', '>', '%', '@', '`'])

/** Number shape accepted for a plain scalar. */
const NUMBER = /^-?\d+(?:\.\d+)?$/

/** Cut a trailing comment, leaving any `#` inside quotes alone. */
function stripComment(line: string): string {
  let quote: '"' | "'" | undefined
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index)
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && (index === 0 || /\s/.test(line.charAt(index - 1)))) return line.slice(0, index)
  }
  return line
}

/** Measure leading indentation, rejecting tabs the way YAML does. */
function measureIndent(line: string, lineNumber: number): number {
  let indent = 0
  while (indent < line.length) {
    const char = line.charAt(indent)
    if (char !== ' ' && char !== '\t') break
    if (char === '\t') throw new YamlError('tab characters are not allowed in indentation', lineNumber)
    indent += 1
  }
  return indent
}

/** Drop comments and blank lines, and measure what remains. */
function scanLines(text: string): SourceLine[] {
  const lines: SourceLine[] = []
  const raw = text.split(/\r?\n/)
  for (let index = 0; index < raw.length; index += 1) {
    const lineNumber = index + 1
    const content = stripComment(raw[index] ?? '').replace(/\s+$/, '')
    if (content.trim() === '') continue
    const indent = measureIndent(content, lineNumber)
    lines.push({ number: lineNumber, indent, content: content.slice(indent) })
  }
  return lines
}

/** Whether one line opens a block sequence item. */
function isSequenceEntry(content: string): boolean {
  return content === '-' || content.startsWith('- ')
}

/** Read a quoted scalar, insisting that the closing quote ends the text. */
function readQuoted(text: string, line: number): string {
  if (text.charAt(0) === "'") {
    let value = ''
    for (let index = 1; index < text.length; index += 1) {
      const char = text.charAt(index)
      if (char !== "'") {
        value += char
        continue
      }
      if (text.charAt(index + 1) === "'") {
        value += "'"
        index += 1
        continue
      }
      if (text.slice(index + 1).trim() !== '') {
        throw new YamlError('unexpected content after a quoted scalar', line)
      }
      return value
    }
    throw new YamlError('unterminated single-quoted string', line)
  }

  let value = ''
  for (let index = 1; index < text.length; index += 1) {
    const char = text.charAt(index)
    if (char === '\\') {
      const escape = text.charAt(index + 1)
      const replacement = DOUBLE_QUOTE_ESCAPES[escape]
      if (escape === '' || replacement === undefined) {
        throw new YamlError(`unsupported escape sequence "\\${escape}"`, line)
      }
      value += replacement
      index += 1
      continue
    }
    if (char === '"') {
      if (text.slice(index + 1).trim() !== '') {
        throw new YamlError('unexpected content after a quoted scalar', line)
      }
      return value
    }
    value += char
  }
  throw new YamlError('unterminated double-quoted string', line)
}

/** Read one plain or quoted scalar value. */
function readScalar(text: string, line: number): YamlScalar {
  if (text === '') return null
  const first = text.charAt(0)
  if (first === '"' || first === "'") return readQuoted(text, line)
  if (text === '~' || text === 'null') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (UNSUPPORTED_LEAD.has(first)) throw new YamlError(`unsupported scalar syntax "${text}"`, line)
  return NUMBER.test(text) ? Number(text) : text
}

/** Read one item of a flow sequence. */
function readFlowItem(text: string, line: number): YamlScalar {
  const trimmed = text.trim()
  if (trimmed === '') throw new YamlError('empty item in a flow sequence', line)
  return readScalar(trimmed, line)
}

/** Read a flow sequence of scalars. */
function readFlowSequence(text: string, line: number): YamlScalar[] {
  if (!text.endsWith(']')) throw new YamlError('unterminated flow sequence; expected "]"', line)
  const inner = text.slice(1, -1)
  if (inner.trim() === '') return []
  const items: YamlScalar[] = []
  let quote: '"' | "'" | undefined
  let current = ''
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner.charAt(index)
    if (quote !== undefined) {
      current += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '[' || char === '{') throw new YamlError('nested flow collections are not supported', line)
    if (char === ']') throw new YamlError('unexpected "]" inside a flow sequence', line)
    if (char === ',') {
      items.push(readFlowItem(current, line))
      current = ''
      continue
    }
    current += char
  }
  if (quote !== undefined) throw new YamlError('unterminated quoted string in a flow sequence', line)
  items.push(readFlowItem(current, line))
  return items
}

/** Read one inline value: a flow sequence or a scalar. */
function readValue(text: string, line: number): YamlValue {
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) return readFlowSequence(trimmed, line)
  if (trimmed.startsWith('{')) throw new YamlError('flow mappings are not supported; use block style', line)
  if (trimmed.startsWith('|') || trimmed.startsWith('>')) throw new YamlError('block scalars are not supported', line)
  if (trimmed.startsWith('&') || trimmed.startsWith('*')) {
    throw new YamlError('anchors and aliases are not supported', line)
  }
  if (trimmed.startsWith('!')) throw new YamlError('tags are not supported', line)
  if (trimmed.startsWith('%')) throw new YamlError('directives are not supported', line)
  return readScalar(trimmed, line)
}

/** Split one `key: value` text, or return undefined when it is a plain value. */
function splitEntry(text: string, line: number): Entry | undefined {
  let quote: '"' | "'" | undefined
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index)
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '[' || char === '{') return undefined
    if (char !== ':') continue
    const next = text.charAt(index + 1)
    if (next !== '' && next !== ' ') continue
    const rawKey = text.slice(0, index).trim()
    if (rawKey === '') throw new YamlError('empty key', line)
    const key = rawKey.startsWith('"') || rawKey.startsWith("'") ? readQuoted(rawKey, line) : rawKey
    const value = text.slice(index + 1).trim()
    return { key, value: value === '' ? undefined : value }
  }
  return undefined
}

/** Reads one document, one indentation level at a time. */
class DocumentReader {
  private index = 0

  private readonly lines: readonly SourceLine[]

  constructor(lines: readonly SourceLine[]) {
    this.lines = lines
  }

  /** Read the whole document; trailing lines are a syntax error. */
  read(): YamlValue {
    const first = this.peek()
    if (first === undefined) return null
    if (first.indent === 0 && first.content === '---') this.index += 1
    const start = this.peek()
    if (start === undefined) return null
    const value = this.readNode(start.indent)
    const trailing = this.peek()
    if (trailing !== undefined) {
      throw new YamlError(
        trailing.indent > start.indent ? 'unexpected indentation' : 'unexpected content after the document root',
        trailing.number,
      )
    }
    return value
  }

  private peek(): SourceLine | undefined {
    return this.lines[this.index]
  }

  /** Read a nested block below `indent`, or null when there is none. */
  private readValueBelow(indent: number): YamlValue {
    const next = this.peek()
    return next !== undefined && next.indent > indent ? this.readNode(next.indent) : null
  }

  private readNode(indent: number): YamlValue {
    const line = this.peek()
    if (line === undefined || line.indent < indent) return null
    return isSequenceEntry(line.content) ? this.readSequence(line.indent) : this.readMapping(line.indent)
  }

  private readMapping(indent: number): YamlValue {
    return Object.fromEntries(this.readMappingEntries(new Map<string, YamlValue>(), indent))
  }

  private readMappingEntries(mapping: Map<string, YamlValue>, indent: number): Map<string, YamlValue> {
    for (;;) {
      const line = this.peek()
      if (line === undefined || line.indent < indent) return mapping
      if (line.indent > indent) throw new YamlError('unexpected indentation', line.number)
      if (isSequenceEntry(line.content)) return mapping
      const entry = splitEntry(line.content, line.number)
      if (entry === undefined) throw new YamlError('expected a "key: value" pair', line.number)
      if (mapping.has(entry.key)) throw new YamlError(`duplicate key "${entry.key}"`, line.number)
      this.index += 1
      mapping.set(
        entry.key,
        entry.value === undefined ? this.readValueBelow(indent) : readValue(entry.value, line.number),
      )
    }
  }

  private readSequence(indent: number): YamlValue[] {
    const items: YamlValue[] = []
    for (;;) {
      const line = this.peek()
      if (line === undefined || line.indent < indent) return items
      if (line.indent > indent) throw new YamlError('unexpected indentation', line.number)
      if (!isSequenceEntry(line.content)) return items
      this.index += 1
      const rest = line.content.slice(1)
      const item = rest.trim()
      if (item === '') {
        items.push(this.readValueBelow(indent))
        continue
      }
      const itemIndent = indent + 1 + (rest.length - rest.trimStart().length)
      const entry = splitEntry(item, line.number)
      if (entry === undefined) {
        items.push(readValue(item, line.number))
        continue
      }
      const mapping = new Map<string, YamlValue>()
      mapping.set(
        entry.key,
        entry.value === undefined ? this.readValueBelow(itemIndent) : readValue(entry.value, line.number),
      )
      this.readMappingEntries(mapping, itemIndent)
      items.push(Object.fromEntries(mapping))
    }
  }
}

/**
 * Parse the supported YAML subset.
 * @param text - Config file contents.
 * @returns The parsed document; an empty document is `null`.
 * @throws YamlError When the text uses syntax outside the supported subset.
 */
export function parseYamlSubset(text: string): YamlValue {
  return new DocumentReader(scanLines(text)).read()
}

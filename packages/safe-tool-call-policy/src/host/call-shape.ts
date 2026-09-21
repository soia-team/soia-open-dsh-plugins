/**
 * Call adapter: reduce a pending tool call to the single line a rule pattern is
 * matched against. Everything here is total — a call whose arguments are
 * missing, frozen, or of the wrong shape reduces to an empty text instead of
 * throwing, because a policy defect must never become a failed call.
 */
import type { ToolCallShape } from '../shared/types.ts'

/** The one argument each understood tool is read from, paired with its shape. */
const COMMAND_ARGUMENT: Record<string, string> = {
  bash: 'command',
}

/** Tools whose target path is the matchable text, prefixed by the tool name as the write verb. */
const PATH_TOOLS = new Set(['write', 'edit'])

/** Read one own string field from arguments that may be anything at all. */
function stringField(args: unknown, key: string): string {
  if (typeof args !== 'object' || args === null) return ''

  const value = (args as Record<string, unknown>)[key]

  return typeof value === 'string' ? value : ''
}

/**
 * Reduce a pending call to `{ tool, text }`.
 *
 * @param tool - tool name as the harness knows it (`exec.name`).
 * @param args - the call's parsed arguments (`exec.arguments`).
 * @returns the matchable shape. Unknown tools, and understood tools called
 *   without their identifying argument, yield an empty text that matches no
 *   shipped rule; a `*` rule written for such a tool can only match on an
 *   explicit empty-text pattern, which no shipped rule uses.
 */
export function callShapeOf(tool: string, args: unknown): ToolCallShape {
  const commandArgument = COMMAND_ARGUMENT[tool]

  if (commandArgument !== undefined) return { tool, text: stringField(args, commandArgument) }

  if (PATH_TOOLS.has(tool)) {
    const path = stringField(args, 'file_path')

    return { tool, text: path.length === 0 ? '' : `${tool} ${path}` }
  }

  return { tool, text: '' }
}

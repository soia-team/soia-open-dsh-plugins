/**
 * Hand-built session-log fixtures.
 *
 * These events reproduce the shapes actually persisted by DSH, read off real
 * artifacts under `$DSH_HOME/sessions` rather than assumed:
 *
 * - the header is one `session` row;
 * - the skill catalog is a `user/message` whose `data.source` is
 *   `{ kind: "skill-catalog", form: "catalog", entries: [{ name, description }] }`;
 * - a load is a `tool/call` with `data.name === "skill"` and `data.arguments`
 *   holding a **JSON string**;
 * - its answer is a `tool/result` whose `data.message.content[0]` is a
 *   `tool-result` block carrying `toolCallId`, `content` and `isError`.
 *
 * No real session file is copied into this repository; only the shape is.
 */
import type { SessionEvent } from '../../src/shared/types.ts'

/** One catalog entry as the loader publishes it. */
export interface FixtureCatalogEntry {
  name: string
  description: string
}

/** The default catalog used by most fixtures, mirroring a real three-skill set. */
export const DEFAULT_CATALOG: FixtureCatalogEntry[] = [
  { name: 'alpha-protocol', description: 'Constraint protocol for engineering work.' },
  { name: 'beta-review', description: 'Read-only review of a code candidate.' },
  { name: 'gamma-release', description: 'Cut a release and tag it.' },
]

/** Build the session header row. */
export function headerEvent(id = 'session-fixture'): SessionEvent {
  return {
    type: 'session',
    version: 3,
    id,
    createdAt: 1_700_000_000_000,
    cwd: '/tmp/fixture-project',
    isSeeded: false,
    delegationDepth: 0,
  }
}

/**
 * Build a `skill-catalog` message row.
 * @param entries - Catalog contents; an empty list is a real retirement event.
 * @param seq - Log position.
 * @param update - Whether this is a replacement rather than the first catalog.
 */
export function catalogEvent(
  entries: FixtureCatalogEntry[] = DEFAULT_CATALOG,
  seq = 2,
  update = false,
): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: 1_700_000_000_001,
    data: {
      content: [{
        type: 'text',
        text: `<system-reminder>\n<available_skills>\n${entries.map((entry) => `- \`${entry.name}\`: ${entry.description}`).join('\n')}\n</available_skills>\n</system-reminder>`,
      }],
      source: {
        kind: 'skill-catalog',
        form: 'catalog',
        ...(update ? { update: true } : {}),
        entries,
      },
      role: 'user',
      id: `catalog-${seq}`,
    },
    surfaceOp: 'append',
  }
}

/**
 * Build a `skill` tool-call row.
 * @param name - Skill name in the arguments.
 * @param callId - Identifier its result must quote back.
 * @param seq - Log position.
 * @param turn - Turn number; steps reset per turn.
 * @param step - Step number.
 */
export function skillCallEvent(
  name: string,
  callId: string,
  seq: number,
  turn = 1,
  step = 1,
): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    time: 1_700_000_000_000 + seq,
    data: { turn, step, callId, name: 'skill', arguments: JSON.stringify({ name }) },
  }
}

/**
 * Build a successful `skill` result row, in the canonical `<skill_content>` shape.
 * @param name - Skill that was loaded.
 * @param callId - Identifier of the call being answered.
 * @param seq - Log position.
 * @param turn - Turn number.
 * @param step - Step number.
 */
export function skillResultEvent(
  name: string,
  callId: string,
  seq: number,
  turn = 1,
  step = 1,
): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    time: 1_700_000_000_000 + seq,
    data: {
      turn,
      step,
      message: {
        source: { kind: 'tool', callId },
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          content: [{
            type: 'text',
            text: [
              `<skill_content name="${name}">`,
              '<skill_resources>',
              `Base directory for this skill: /fixture/skills/${name}`,
              '</skill_resources>',
              '',
              '<skill_instructions>',
              `# ${name}`,
              '</skill_instructions>',
              '</skill_content>',
            ].join('\n'),
          }],
          isError: false,
        }],
        role: 'user',
        id: `result-${callId}`,
      },
    },
    sourceEventSeqs: [seq - 1],
    surfaceOp: 'append',
  }
}

/**
 * Build a failed `skill` result row, matching the loader's error wording.
 * @param errorText - Message the loader returned.
 * @param callId - Identifier of the call being answered.
 * @param seq - Log position.
 */
export function skillErrorResultEvent(errorText: string, callId: string, seq: number): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    time: 1_700_000_000_000 + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        source: { kind: 'tool', callId },
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'text', text: errorText }],
          isError: true,
        }],
        role: 'user',
        id: `result-${callId}`,
      },
    },
    surfaceOp: 'append',
  }
}

/**
 * Build a non-`skill` tool call, the evidence that work continued after a load.
 * @param toolName - Name of the tool the session called.
 * @param callId - Identifier for the call.
 * @param seq - Log position.
 * @param turn - Turn number.
 * @param step - Step number.
 */
export function otherToolCallEvent(
  toolName: string,
  callId: string,
  seq: number,
  turn = 1,
  step = 2,
): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    time: 1_700_000_000_000 + seq,
    data: { turn, step, callId, name: toolName, arguments: '{}' },
  }
}

/**
 * Build an assistant text row, used to close a turn.
 * @param text - Assistant text.
 * @param seq - Log position.
 */
export function assistantMessageEvent(text: string, seq: number): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: 1_700_000_000_000 + seq,
    data: {
      turn: 1,
      step: seq,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model' },
      },
    },
    surfaceOp: 'append',
  }
}

/**
 * Serialise events as a session log.
 *
 * `joined` reproduces the later-generation container, which concatenates records
 * with **no** separating newline — the case a line-oriented parser fuses into one
 * unparseable row.
 *
 * @param events - Events to serialise.
 * @param joined - Whether to omit newlines between records.
 * @returns Log text.
 */
export function toLogText(events: readonly SessionEvent[], joined = false): string {
  const rows = events.map((event) => JSON.stringify(event))
  return joined ? rows.join('') : `${rows.join('\n')}\n`
}

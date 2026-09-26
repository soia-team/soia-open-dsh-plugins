import { describe, expect, it } from 'vitest'

import {
  RECENT_EVENT_LIMIT,
  summarizeToolResult,
  INITIAL_LIVE_TASK_STATE,
  CLIENT_WINDOWS,
  foldLiveTasks,
  hasLiveActivity,
  reduceLiveTask,
} from '../../src/shared/live-task-state.ts'
import type {
  LiveEventLike,
  LiveTaskObservation,
  LiveTaskState,
} from '../../src/shared/types.ts'

/** One durable event observation with a synthetic but well-formed envelope. */
function event(
  type: string,
  seq: number,
  data: unknown,
  time = seq * 1000,
): LiveTaskObservation {
  const envelope: LiveEventLike = { type, seq, time, data }
  return { kind: 'event', event: envelope }
}

/** One transient text delta for an open step. */
function delta(
  text: string,
  time: number,
  turn = 1,
  step = 1,
): LiveTaskObservation {
  return { kind: 'text-delta', turn, step, time, text }
}

/** A `tool/result` payload shaped the way the session log records one. */
function toolResult(callId: string, isError = false): unknown {
  return {
    turn: 1,
    step: 1,
    message: { role: 'user', content: [{ type: 'tool-result', toolCallId: callId, isError }] },
  }
}

/** Open turn 1 / step 1 with one tool call in flight. */
function openStepWithTool(): LiveTaskObservation[] {
  return [
    event('turn/start', 1, { turn: 1 }),
    event('step/start', 2, { turn: 1, step: 1 }),
    event('tool/call', 3, { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{}' }),
  ]
}

describe('live-task derivation', () => {
  describe('an empty event stream', () => {
    it('folds to the shared initial state', () => {
      expect(foldLiveTasks([])).toEqual(INITIAL_LIVE_TASK_STATE)
    })

    it('reports no activity and no running turn', () => {
      const state = foldLiveTasks([])

      expect(hasLiveActivity(state)).toBe(false)
      expect(state.running).toBe(false)
      expect(state.turn).toBeNull()
      expect(state.lastTool).toBeNull()
      expect(state.lastEvent).toBeNull()
      expect(state.endedReason).toBeNull()
    })

    it('exposes the initial state as one frozen identity', () => {
      expect(Object.isFrozen(INITIAL_LIVE_TASK_STATE)).toBe(true)
      expect(INITIAL_LIVE_TASK_STATE.openTools).toHaveLength(0)
    })
  })

  describe('a session that only produced assistant text', () => {
    it('counts streamed characters for the open step without moving the last durable event', () => {
      let state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('step/start', 2, { turn: 1, step: 1 }),
      ])
      state = reduceLiveTask(state, delta('hello ', 3000))
      state = reduceLiveTask(state, delta('world', 3010))

      expect(state.streamedTextLength).toBe(11)
      expect(state.streamedAt).toBe(3010)
      expect(state.updatedAt).toBe(3010)
      expect(state.running).toBe(true)
      // Transient text is progress, not an event: the last event line still
      // names the durable thing that happened.
      expect(state.lastEvent?.type).toBe('step/start')
    })

    it('does not count deltas for a step that is not open', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('step/start', 2, { turn: 1, step: 1 }),
        delta('ignored', 3000, 1, 2),
      ])

      expect(state.streamedTextLength).toBe(0)
    })

    it('does not count deltas once the turn has closed', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
        delta('late', 5000),
      ])

      expect(state.streamedTextLength).toBe(0)
    })

    it('ignores a delta older than the last one it folded', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('step/start', 2, { turn: 1, step: 1 }),
        delta('newer', 3000),
        delta('older', 2999),
      ])

      expect(state.streamedTextLength).toBe(5)
      expect(state.streamedAt).toBe(3000)
    })

    it('counts two deltas that share a millisecond', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('step/start', 2, { turn: 1, step: 1 }),
        delta('ab', 3000),
        delta('cd', 3000),
      ])

      expect(state.streamedTextLength).toBe(4)
    })

    it('resets the counter when the durable message supersedes the stream', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('step/start', 2, { turn: 1, step: 1 }),
        delta('streamed', 3000),
        event('assistant/message', 3, { turn: 1, step: 1, message: {}, stream: [] }),
      ])

      expect(state.streamedTextLength).toBe(0)
      expect(state.streamedAt).toBeNull()
      expect(state.lastEvent?.type).toBe('assistant/message')
    })
  })

  describe('a session that called a tool', () => {
    it('tracks the call as in flight', () => {
      const state = foldLiveTasks(openStepWithTool())

      expect(state.lastTool).toMatchObject({
        callId: 'call-1',
        name: 'bash',
        turn: 1,
        step: 1,
        open: true,
        // No `arguments` on this fixture: absence is reported, not invented.
        detail: null,
        // The activity log needs a start instant to render "when" and "how long".
        startedAt: 3000,
      })
      expect(state.openTools).toHaveLength(1)
      expect(state.toolCallsInTurn).toBe(1)
      expect(state.lastEvent).toEqual({
        type: 'tool/call',
        seq: 3,
        time: 3000,
        detail: 'bash',
      })
    })

    it('settles the call when its result arrives', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('tool/result', 4, toolResult('call-1')),
      ])

      expect(state.openTools).toHaveLength(0)
      expect(state.lastTool?.open).toBe(false)
      expect(state.lastTool?.failed).toBeUndefined()
      expect(state.toolCallsInTurn).toBe(1)
      expect(state.lastEvent?.detail).toBe('bash')
    })

    it('settles a plain-text receipt via message.source.callId', () => {
      // skill 这类工具的回执是纯文本块（content[0] 没有 toolCallId），callId 只在
      // message.source 里——真会话里缺这个回退，行会永远停在"进行中"
      // （已结束会话里两条 skill 行卡在 进行中 4746 秒 的实况）。
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('tool/result', 4, {
          turn: 1,
          step: 1,
          message: {
            role: 'tool',
            source: { kind: 'tool', callId: 'call-1' },
            content: [{ type: 'text', text: 'loaded' }],
          },
        }),
      ])

      expect(state.openTools).toHaveLength(0)
      expect(state.lastTool?.open).toBe(false)
      expect(state.lastTool?.failed).toBeUndefined()
    })

    it('marks a failing result and names the tool from the open call', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('tool/result', 4, toolResult('call-1', true)),
      ])

      expect(state.lastTool?.failed).toBe(true)
      expect(state.lastEvent?.detail).toBe('bash')
    })

    it('keeps the previous state consistent for a result naming an unknown call', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('tool/result', 4, toolResult('call-other', true)),
      ])

      expect(state.openTools).toHaveLength(1)
      expect(state.lastTool?.open).toBe(true)
      expect(state.lastTool?.failed).toBeUndefined()
      expect(state.lastEvent?.detail).toBeNull()
      expect(state.seq).toBe(4)
    })

    it('counts two calls issued in one step and settles them independently', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('step/start', 2, { turn: 1, step: 1 }),
        event('tool/call', 3, { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{}' }),
        event('tool/call', 4, { turn: 1, step: 1, callId: 'b', name: 'write', arguments: '{}' }),
        event('tool/result', 5, toolResult('a')),
      ])

      expect(state.toolCallsInTurn).toBe(2)
      expect(state.openTools.map((call) => call.callId)).toEqual(['b'])
      expect(state.lastTool?.callId).toBe('b')
    })

    it('ignores a malformed call payload but still advances the envelope', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('tool/call', 2, { turn: 1, step: 1, name: 'bash' }),
      ])

      expect(state.lastTool).toBeNull()
      expect(state.seq).toBe(2)
      expect(state.lastEvent?.type).toBe('tool/call')
      expect(state.lastEvent?.detail).toBeNull()
    })

    it('tolerates a result payload with no readable call id', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('tool/result', 4, { turn: 1, step: 1 }),
      ])

      expect(state.openTools).toHaveLength(1)
      expect(state.lastTool?.open).toBe(true)
      expect(state.seq).toBe(4)
    })
  })

  describe('a long task still in progress', () => {
    it('stays running with the tool in flight across many deltas', () => {
      const deltas = Array.from({ length: 50 }, (_, index) =>
        delta('x', 4000 + index))
      const state = foldLiveTasks([...openStepWithTool(), ...deltas])

      expect(state.running).toBe(true)
      expect(state.turn).toBe(1)
      expect(state.step).toBe(1)
      expect(state.openTools).toHaveLength(1)
      expect(state.streamedTextLength).toBe(50)
      expect(state.updatedAt).toBe(4049)
      expect(state.endedReason).toBeNull()
    })

    it('closes the step but keeps the turn running at step/end', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('step/end', 4, { turn: 1, step: 1 }),
      ])

      expect(state.running).toBe(true)
      expect(state.step).toBeNull()
      expect(state.turn).toBe(1)
    })

    it('ignores a step/end that names a different step', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('step/end', 4, { turn: 1, step: 9 }),
      ])

      expect(state.step).toBe(1)
    })
  })

  describe('out-of-order and duplicated observations', () => {
    it('returns the same state reference for a duplicated event', () => {
      const before = foldLiveTasks(openStepWithTool())
      const after = reduceLiveTask(
        before,
        event('tool/call', 3, { turn: 1, step: 1, callId: 'call-1', name: 'bash' }),
      )

      expect(after).toBe(before)
    })

    it('returns the same state reference for an older event after a newer one', () => {
      const before = foldLiveTasks([
        ...openStepWithTool(),
        event('tool/result', 4, toolResult('call-1')),
      ])
      const after = reduceLiveTask(before, event('turn/start', 1, { turn: 1 }))

      expect(after).toBe(before)
      expect(after.running).toBe(true)
      expect(after.toolCallsInTurn).toBe(1)
    })

    it('returns the same state reference for an event with an unusable seq', () => {
      const before = foldLiveTasks(openStepWithTool())
      const after = reduceLiveTask(before, {
        kind: 'event',
        event: { type: 'turn/end', seq: Number.NaN, time: 9000, data: {} },
      })

      expect(after).toBe(before)
    })

    it('reaches the same state whether duplicates are interleaved or not', () => {
      const clean = foldLiveTasks([
        ...openStepWithTool(),
        event('tool/result', 4, toolResult('call-1')),
      ])
      const noisy = foldLiveTasks([
        ...openStepWithTool(),
        event('tool/call', 3, { turn: 1, step: 1, callId: 'call-1', name: 'bash' }),
        event('step/start', 2, { turn: 1, step: 1 }),
        event('tool/result', 4, toolResult('call-1')),
      ])

      expect(noisy).toEqual(clean)
    })

    it('closes the turn on a turn/end that arrives after a duplicated tool call', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('tool/call', 3, { turn: 1, step: 1, callId: 'call-1', name: 'bash' }),
        event('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
      ])

      expect(state.running).toBe(false)
      expect(state.endedReason).toBe('completed')
    })
  })

  describe('a session whose turn ended', () => {
    it('reports not running, no open step, and no in-flight tools', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
      ])

      expect(state.running).toBe(false)
      expect(state.step).toBeNull()
      expect(state.openTools).toHaveLength(0)
      expect(state.endedReason).toBe('completed')
      // The last tool stays readable after the turn closes: it is the most
      // recent tool call at any age, not only the in-flight one.
      expect(state.lastTool?.name).toBe('bash')
      expect(state.lastTool?.open).toBe(false)
    })

    it('still records a result that lands after the turn closed', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('turn/end', 4, { turn: 1, reason: { kind: 'aborted' } }),
        event('tool/result', 5, toolResult('call-1', true)),
      ])

      expect(state.running).toBe(false)
      expect(state.lastTool?.failed).toBe(true)
      expect(state.lastTool?.open).toBe(false)
    })

    it('carries the end reason verbatim for each known kind', () => {
      for (const kind of ['completed', 'aborted', 'blocked', 'error', 'max-tokens']) {
        const state = foldLiveTasks([
          event('turn/start', 1, { turn: 1 }),
          event('turn/end', 2, { turn: 1, reason: { kind } }),
        ])
        expect(state.endedReason).toBe(kind)
      }
    })

    it('reports an unreadable reason as unknown rather than as no end', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('turn/end', 2, { turn: 1 }),
      ])

      expect(state.endedReason).toBe('unknown')
    })

    it('starts a fresh turn clean after a previous one ended', () => {
      const state = foldLiveTasks([
        ...openStepWithTool(),
        event('turn/end', 4, { turn: 1, reason: { kind: 'error' } }),
        event('turn/start', 5, { turn: 2 }),
      ])

      expect(state.running).toBe(true)
      expect(state.turn).toBe(2)
      expect(state.endedReason).toBeNull()
      expect(state.toolCallsInTurn).toBe(0)
      expect(state.openTools).toHaveLength(0)
    })
  })

  describe('event types this build does not know', () => {
    it('advances the envelope without inventing domain state', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('some/future-event', 2, { anything: true }, 7000),
      ])

      expect(state.seq).toBe(2)
      expect(state.updatedAt).toBe(7000)
      expect(state.lastEvent?.type).toBe('some/future-event')
      expect(state.lastEvent?.detail).toBeNull()
      expect(state.running).toBe(true)
    })

    it('treats a non-object payload as an event with nothing to read', () => {
      const state = foldLiveTasks([event('turn/start', 1, 'not-an-object')])

      expect(state.seq).toBe(1)
      expect(state.turn).toBeNull()
      expect(state.running).toBe(true)
    })
  })

  describe('identity stability of the folded state', () => {
    it('never mutates the state it was given', () => {
      const before = foldLiveTasks(openStepWithTool())
      const snapshot: LiveTaskState = before
      reduceLiveTask(before, event('tool/result', 4, toolResult('call-1')))

      expect(snapshot).toBe(before)
      expect(before.openTools).toHaveLength(1)
      expect(before.seq).toBe(3)
    })

    it('folds a long interleaved stream without losing the newest seq', () => {
      const observations: LiveTaskObservation[] = [event('turn/start', 1, { turn: 1 })]
      for (let seq = 2; seq <= 40; seq += 1) {
        observations.push(event('step/start', seq, { turn: 1, step: seq }))
        observations.push(event('step/start', seq - 1, { turn: 1, step: seq - 1 }))
      }

      const state = foldLiveTasks(observations)

      expect(state.seq).toBe(40)
      expect(state.step).toBe(40)
    })
  })
})

  describe('what the call was asked to do', () => {
    const callEvent = (callId: string, name: string, args: unknown): LiveTaskObservation =>
      event('tool/call', 3, { callId, name, turn: 1, step: 1, arguments: args })

    it('reads the command out of a JSON-string argument payload', () => {
      // The session records `arguments` as a JSON string, which is why this is
      // parsed rather than read as an object.
      const state = foldLiveTasks([event('turn/start', 1, { turn: 1 }), callEvent('call-1', 'bash', JSON.stringify({ command: 'sleep 30 && echo done' }))])
      expect(state.lastTool?.detail).toBe('sleep 30 && echo done')
    })

    it('falls back to the path for a file tool and clips a long value', () => {
      const long = `/very/long/${'x'.repeat(200)}.ts`
      const state = foldLiveTasks([event('turn/start', 1, { turn: 1 }), callEvent('call-1', 'write', { file_path: long })])
      expect(state.lastTool?.detail?.startsWith('/very/long/')).toBe(true)
      expect(state.lastTool?.detail?.endsWith('…')).toBe(true)
      expect(state.lastTool?.detail?.length).toBeLessThanOrEqual(80)
    })

    it('reports absence rather than guessing when the payload is unreadable', () => {
      const state = foldLiveTasks([event('turn/start', 1, { turn: 1 }), callEvent('call-1', 'bash', '{not json')])
      // The raw text is still the most useful thing available, so it is shown…
      expect(state.lastTool?.detail).toBe('{not json')
      // …while a payload with nothing readable at all reports null.
      const empty = foldLiveTasks([event('turn/start', 1, { turn: 1 }), callEvent('call-2', 'bash', { count: 3 })])
      expect(empty.lastTool?.detail).toBeNull()
    })
  })

  describe('the recent-events trail', () => {
    it('keeps the newest observations last and never grows past the limit', () => {
      const observations: LiveTaskObservation[] = [event('turn/start', 1, { turn: 1 })]
      for (let i = 0; i < 12; i += 1) {
        observations.push(event('step/start', 2 + i, { turn: 1, step: i }))
      }
      const state = foldLiveTasks(observations)

      expect(state.recent).toHaveLength(RECENT_EVENT_LIMIT)
      expect(state.recent.at(-1)?.seq).toBe(13)
      expect(state.recent[0]?.seq).toBe(8)
    })
  })

  describe('the recent-events trail', () => {
    it('leaves transport receipts out of the trail but still reports them as the last event', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('session-log-deepseek/delivery-accepted', 2, { accepted: true }),
      ])

      expect(state.lastEvent?.type).toBe('session-log-deepseek/delivery-accepted')
      expect(state.recent.map((entry) => entry.type)).toEqual(['turn/start'])
    })
  })

  describe('lines a person can read', () => {
    it('joins what and where for a measuring call', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('tool/call', 2, {
          callId: 'c1',
          name: 'check_ui_size',
          turn: 1,
          step: 1,
          arguments: JSON.stringify({ selector: '#card', url: 'http://127.0.0.1:8899/second-case.html', expected: { width: 320 } }),
        }),
      ])
      expect(state.lastTool?.detail).toBe('#card @ http://127.0.0.1:8899/second-case.html')
    })

    it('summarizes a JSON result as key=value instead of raw braces', () => {
      const summary = summarizeToolResult({
        message: {
          content: [{
            type: 'tool-result',
            content: [{ type: 'text', text: '{"status":"ok","selector":"#card","width":320,"nested":{"a":1}}' }],
          }],
        },
      })
      expect(summary).toBe('status=ok, selector=#card, width=320')
    })

    it('keeps prose results as they are', () => {
      const summary = summarizeToolResult({
        message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'done\nsecond line' }] }] },
      })
      expect(summary).toBe('done')
    })
  })

  describe('a call that came back as an error', () => {
    const call = event('tool/call', 2, {
      callId: 'c1', name: 'bash', turn: 1, step: 1, arguments: JSON.stringify({ command: 'rg TODO .' }),
    })
    const result = (isError: boolean, text: string): LiveTaskObservation => event('tool/result', 3, {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'tool-result', isError, toolCallId: 'c1', content: [{ type: 'text', text }] }] },
    })

    it('records the failure in the activity log, not just on the last-call record', () => {
      // The live panel showed a red "Error: grep search failed" row while the
      // overview counted zero failures: the flag reached `lastTool` but not the
      // action record, which is what the log and the counter read.
      const state = foldLiveTasks([event('turn/start', 1, { turn: 1 }), call, result(true, 'Error: grep search failed (exit 2)')])

      expect(state.actions).toHaveLength(1)
      expect(state.actions[0]?.status).toBe('failed')
      expect(state.actions[0]?.result).toBe('Error: grep search failed (exit 2)')
      expect(state.lastTool?.failed).toBe(true)
    })

    it('keeps a successful result as ok', () => {
      const state = foldLiveTasks([event('turn/start', 1, { turn: 1 }), call, result(false, 'done')])

      expect(state.actions[0]?.status).toBe('ok')
      expect(state.actions[0]?.result).toBe('done')
    })
  })

  describe('a tool that reports failure in its own payload', () => {
    it('counts as failed even though the harness saw no error', () => {
      // Measured live: an unreachable page and a missing file both came back as
      // `{"status":"error",…}` inside a successful tool result, and the panel
      // showed them as 完成 with a failure count of zero.
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('tool/call', 2, { callId: 'c1', name: 'check_ui_size', turn: 1, step: 1, arguments: '{}' }),
        event('tool/result', 3, {
          turn: 1,
          step: 1,
          message: {
            content: [{
              type: 'tool-result',
              isError: false,
              toolCallId: 'c1',
              content: [{ type: 'text', text: '{"status":"error","code":"navigation_failed"}' }],
            }],
          },
        }),
      ])

      expect(state.actions[0]?.status).toBe('failed')
    })

    it('leaves an ordinary payload alone', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('tool/call', 2, { callId: 'c1', name: 'check_file_hash', turn: 1, step: 1, arguments: '{}' }),
        event('tool/result', 3, {
          turn: 1,
          step: 1,
          message: {
            content: [{
              type: 'tool-result',
              isError: false,
              toolCallId: 'c1',
              content: [{ type: 'text', text: '{"status":"ok","hash":"abc"}' }],
            }],
          },
        }),
      ])

      expect(state.actions[0]?.status).toBe('ok')
    })
  })

  describe('the panel reports its own health', () => {
    it('counts folded events and unknown types separately', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('tool/call', 2, { callId: 'c1', name: 'bash', turn: 1, step: 1, arguments: '{}' }),
        event('some/new-event-type', 3, { anything: true }),
      ])

      expect(state.health.folded).toBe(3)
      // A host newer than the plugin shows up as a number instead of silence.
      expect(state.health.unknown).toBe(1)
    })

    it('counts accepted and dropped stream deltas', () => {
      const accepted = reduceLiveTask(
        foldLiveTasks([event('turn/start', 1, { turn: 1 }), event('step/start', 2, { turn: 1, step: 1 })]),
        { kind: 'text-delta', turn: 1, step: 1, time: 3, text: 'hello' },
      )
      expect(accepted.health.deltasAccepted).toBe(1)
      expect(accepted.health.deltasDropped).toBe(0)

      // A delta for a step that is not open is dropped, and the drop is counted:
      // "the model went quiet" and "this filter ate the frame" must be told apart.
      const dropped = reduceLiveTask(accepted, { kind: 'text-delta', turn: 1, step: 9, time: 4, text: 'stray' })
      expect(dropped.health.deltasAccepted).toBe(1)
      expect(dropped.health.deltasDropped).toBe(1)
    })
  })

  describe('stream-frame counting', () => {
    it('counts a frame as received even when normalization drops it', () => {
      // The distinction that matters on screen: a listener that never fires
      // versus a frame the fold could not use. Frames are counted on arrival.
      const state = reduceLiveTask(INITIAL_LIVE_TASK_STATE, { kind: 'stream-frame' })

      expect(state.health.frames).toBe(1)
      expect(state.health.deltasAccepted).toBe(0)
      expect(state.health.deltasDropped).toBe(0)
    })
  })

  describe('counts name their scope', () => {
    it('keeps a session total that a new turn does not reset', () => {
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('tool/call', 2, { callId: 'c1', name: 'bash', turn: 1, step: 1, arguments: '{}' }),
        event('turn/end', 3, { turn: 1, reason: { kind: 'completed' } }),
        event('turn/start', 4, { turn: 2 }),
        event('tool/call', 5, { callId: 'c2', name: 'read', turn: 2, step: 1, arguments: '{}' }),
      ])

      // Turn scope resets; session scope does not. The panel used to show only
      // the capped eight-row window under the label "tool calls", which read as
      // a session count and was not one.
      expect(state.toolCallsInTurn).toBe(1)
      expect(state.toolCallsTotal).toBe(2)
    })

    it('counts failures for the session, not just for the current window', () => {
      const failing = event('tool/result', 3, {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'tool-result', isError: true, toolCallId: 'c1', content: [{ type: 'text', text: 'boom' }] }] },
      })
      const state = foldLiveTasks([
        event('turn/start', 1, { turn: 1 }),
        event('tool/call', 2, { callId: 'c1', name: 'bash', turn: 1, step: 1, arguments: '{}' }),
        failing,
      ])

      expect(state.failuresTotal).toBe(1)
    })
  })

  describe('the tools the host offered', () => {
    it('reads the count out of the request header', () => {
      // The header is the only place the offered-tool list exists, and it spans
      // official and third-party tools — not just the ones this repository ships.
      const state = foldLiveTasks([
        event('request/header', 1, {
          header: { config: { tools: [{ name: 'bash' }, { name: 'read' }, { name: 'check_ui_size' }] } },
        }),
      ])

      expect(state.toolsAvailable).toBe(3)
    })

    it('reports absence when the header carries no tool list', () => {
      const state = foldLiveTasks([event('request/header', 1, { header: { config: {} } })])

      expect(state.toolsAvailable).toBeNull()
    })
  })

describe('client windows (the archive fold)', () => {
  it('keeps every row of the resident window, not the wire cap', () => {
    let bounded = INITIAL_LIVE_TASK_STATE
    let unbounded = INITIAL_LIVE_TASK_STATE
    for (let i = 1; i <= 500; i += 1) {
      const observation = event('user/message', i, { content: [{ type: 'text', text: `m${i}` }] })
      bounded = reduceLiveTask(bounded, observation)
      unbounded = reduceLiveTask(unbounded, observation, CLIENT_WINDOWS)
    }

    // The host projection stays bounded: that cap exists to bound the wire.
    expect(bounded.timeline.length).toBe(384)
    // The browser keeps the whole window: no wire, no checkpoint to protect.
    expect(unbounded.timeline.length).toBe(500)
    expect(unbounded.seq).toBe(500)
  })
})

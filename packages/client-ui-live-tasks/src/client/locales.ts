/**
 * Dictionaries of the `liveTasks` namespace.
 *
 * Simplified Chinese is the key-set source of truth; English carries the
 * identical key set, so neither direction can leave a key unresolved. Only
 * human-facing panel copy lives here — the package adds nothing model-visible,
 * and a protocol token such as a tool name or a `TurnEndReason.kind` is
 * rendered verbatim rather than translated.
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'liveTasks'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.running': '正在跑',
  'section.recent': '最近事件',
  'tool.none': '当前没有在跑的调用',
  'time.runningFor': '已运行 {s} 秒',
  'time.agoSeconds': '{s} 秒前',
  'time.agoMinutes': '{m} 分前',
  'time.justNow': '刚刚',
  'view.tab': '任务',
  'view.title': '会话任务状态',
  'view.empty': '本会话当前没有进行中的任务。',
  'panel.empty': '本次会话还没有事件。',
  'row.phase': '状态',
  'row.turn': '回合',
  'row.step': '步骤',
  'row.lastTool': '最后工具调用',
  'row.toolCalls': '本轮工具调用数',
  'row.lastEvent': '最后事件',
  'row.endedReason': '结束原因',
  'phase.running': '运行中',
  'phase.tool': '等待工具结果',
  'phase.idle': '空闲',
  'phase.ended': '已结束',
  'tool.open': '进行中',
  'tool.failed': '失败',
  'tool.done': '已完成',
  'value.none': '无',
  'value.openCount': '{count} 个进行中',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<LiveTaskKey, string> = {
  'section.running': 'In flight',
  'section.recent': 'Recent events',
  'tool.none': 'No call in flight',
  'time.runningFor': 'running for {s}s',
  'time.agoSeconds': '{s}s ago',
  'time.agoMinutes': '{m}m ago',
  'time.justNow': 'just now',
  'view.tab': 'Tasks',
  'view.title': 'Session task state',
  'view.empty': 'This session has no task in progress.',
  'panel.empty': 'This session has no events yet.',
  'row.phase': 'State',
  'row.turn': 'Turn',
  'row.step': 'Step',
  'row.lastTool': 'Last tool call',
  'row.toolCalls': 'Tool calls this turn',
  'row.lastEvent': 'Last event',
  'row.endedReason': 'Ended',
  'phase.running': 'running',
  'phase.tool': 'waiting for a tool result',
  'phase.idle': 'idle',
  'phase.ended': 'ended',
  'tool.open': 'in flight',
  'tool.failed': 'failed',
  'tool.done': 'settled',
  'value.none': 'none',
  'value.openCount': '{count} in flight',
}

/** Key domain of the `liveTasks` namespace (`zh` is the source of truth). */
export type LiveTaskKey = keyof typeof zh

/**
 * Dictionaries of the `liveTasks` namespace.
 *
 * Simplified Chinese is the key-set source of truth; English is typed as
 * `Record<LiveTaskKey, string>` so a missing or extra key is a compile error in
 * either direction.
 *
 * This namespace exists because the view talks to a person, and a person reads
 * "正在跑 / 干了什么 / 结果" rather than a session log's vocabulary. Tool names
 * and event types are the one thing deliberately left untranslated: they are
 * protocol identifiers, and paraphrasing them would hide which tool ran.
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'liveTasks'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.tab': '任务',
  'view.title': '本会话在做什么',
  'view.empty': '本会话还没有动作。',
  'section.running': '正在跑',
  'section.actions': '干过什么',
  'section.recent': '最近动静',
  'col.tool': '工具',
  'col.did': '干了什么',
  'col.result': '结果',
  'status.ok': '完成',
  'status.failed': '失败',
  'status.running': '进行中',
  'time.at': '时间',
  'time.durationSeconds': '{s} 秒',
  'time.runningFor': '已运行 {s} 秒',
  'tool.none': '现在没有在跑的动作',
  'phase.running': '正在干活',
  'phase.tool': '等工具返回',
  'phase.idle': '空闲',
  'phase.ended': '已结束',
  'event.turnStart': '开始处理',
  'event.turnEnd': '处理结束',
  'event.stepStart': '开始第 {n} 步',
  'event.stepEnd': '第 {n} 步结束',
  'event.userMessage': '收到你的消息',
  'event.assistantMessage': '模型回复',
  'event.toolCall': '调用 {name}',
  'event.toolResult': '{name} 返回',
  'event.other': '其他活动',
} as const

/** Key set of the Chinese dictionary. */
export type LiveTaskKey = keyof typeof zh

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<LiveTaskKey, string> = {
  'view.tab': 'Tasks',
  'view.title': 'What this session is doing',
  'view.empty': 'This session has no actions yet.',
  'section.running': 'Running now',
  'section.actions': 'What it did',
  'section.recent': 'Recent activity',
  'col.tool': 'tool',
  'col.did': 'what it did',
  'col.result': 'result',
  'status.ok': 'done',
  'status.failed': 'failed',
  'status.running': 'running',
  'time.at': 'time',
  'time.durationSeconds': '{s}s',
  'time.runningFor': 'running for {s}s',
  'tool.none': 'Nothing is running right now',
  'phase.running': 'working',
  'phase.tool': 'waiting for a tool',
  'phase.idle': 'idle',
  'phase.ended': 'finished',
  'event.turnStart': 'started working',
  'event.turnEnd': 'finished working',
  'event.stepStart': 'step {n} started',
  'event.stepEnd': 'step {n} finished',
  'event.userMessage': 'your message arrived',
  'event.assistantMessage': 'model replied',
  'event.toolCall': 'called {name}',
  'event.toolResult': '{name} returned',
  'event.other': 'other activity',
}

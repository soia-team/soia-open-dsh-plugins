/**
 * Dictionaries of the `liveTasks` namespace.
 *
 * The panel is organised as modules — an overview, what is running, what it did,
 * what just happened — and the keys mirror that structure (`overview.*`,
 * `running.*`, `log.*`, `recent.*`) so copy can be read against the layout.
 *
 * Simplified Chinese is the key-set source of truth; English is typed as
 * `Record<LiveTaskKey, string>`, so a missing or extra key is a compile error in
 * either direction. Tool names and event types are deliberately left
 * untranslated: they are protocol identifiers, and paraphrasing them would hide
 * which tool actually ran.
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'liveTasks'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.tab': '任务',
  'view.empty': '本会话还没有动作。',

  // 模块一：概览
  'overview.title': '概览',
  'overview.status': '状态',
  'overview.at': '位置',
  'overview.elapsed': '已运行',
  'overview.calls': '工具调用',
  'overview.failures': '失败',
  'overview.atValue': '#{turn} · 第 {step} 步',
  'overview.turnOnly': '#{turn}',

  // 模块二：正在跑
  'running.title': '正在跑',
  'running.empty': '现在没有在跑的动作',
  'running.started': '已跑 {s} 秒',

  // 模块三：动作日志
  'log.title': '动作日志',
  'log.filterAll': '全部 {n}',
  'log.filterFailed': '只看失败 {n}',
  'log.filterEmpty': '没有符合条件的记录',
  'log.time': '时间',
  'log.tool': '工具',
  'log.did': '干了什么',
  'log.took': '耗时',
  'log.result': '结果',

  // 模块四：最近动静
  'recent.title': '最近动静',

  // 状态词与时间单位
  'status.ok': '完成',
  'status.failed': '失败',
  'status.running': '进行中',
  'phase.running': '正在干活',
  'phase.tool': '等工具返回',
  'phase.idle': '空闲',
  'phase.ended': '已结束',
  'time.seconds': '{s} 秒',
  'time.justNow': '刚刚',
  'time.agoSeconds': '{s} 秒前',
  'time.agoMinutes': '{m} 分前',

  // 人话短句
  'event.turnStart': '开始处理',
  'event.turnEnd': '处理结束',
  'event.userMessage': '收到你的消息',
  'event.assistantMessage': '模型回复',
  'event.toolCall': '调用 {name}',
  'event.toolResult': '{name} 返回',
} as const

/** Key set of the Chinese dictionary. */
export type LiveTaskKey = keyof typeof zh

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<LiveTaskKey, string> = {
  'view.tab': 'Tasks',
  'view.empty': 'This session has no actions yet.',

  'overview.title': 'Overview',
  'overview.status': 'State',
  'overview.at': 'Position',
  'overview.elapsed': 'Elapsed',
  'overview.calls': 'Tool calls',
  'overview.failures': 'Failures',
  'overview.atValue': '#{turn} · step {step}',
  'overview.turnOnly': '#{turn}',

  'running.title': 'Running now',
  'running.empty': 'Nothing is running right now',
  'running.started': '{s}s so far',

  'log.title': 'Activity log',
  'log.filterAll': 'All {n}',
  'log.filterFailed': 'Failures only {n}',
  'log.filterEmpty': 'No record matches this filter',
  'log.time': 'time',
  'log.tool': 'tool',
  'log.did': 'what it did',
  'log.took': 'took',
  'log.result': 'result',

  'recent.title': 'Just happened',

  'status.ok': 'done',
  'status.failed': 'failed',
  'status.running': 'running',
  'phase.running': 'working',
  'phase.tool': 'waiting for a tool',
  'phase.idle': 'idle',
  'phase.ended': 'finished',
  'time.seconds': '{s}s',
  'time.justNow': 'just now',
  'time.agoSeconds': '{s}s ago',
  'time.agoMinutes': '{m}m ago',

  'event.turnStart': 'started working',
  'event.turnEnd': 'finished working',
  'event.userMessage': 'your message arrived',
  'event.assistantMessage': 'model replied',
  'event.toolCall': 'called {name}',
  'event.toolResult': '{name} returned',
}

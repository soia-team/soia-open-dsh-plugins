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
  // 页签名取「活动」而不是「任务」：待办类插件已经占用了「任务」，而这里是实时活动时间线。
  'view.tab': '活动',
  'view.empty': '本会话还没有动作。',

  // 模块一：概览
  'head.toolRunning': '正在用的工具',
  'head.toolLast': '最近用的工具',
  'head.toolNone': '还没有用过工具',
  'axis.title': '轮次横轴（时间向右）',
  'axis.turn': '第 {n} 轮',
  'axis.summary': '本会话 {turns} 轮 · {calls} 次调用 · 失败 {failures} · 可用工具 {tools}（用到 {used} 种）',
  'turn.tools': '{n} 个工具',
  'turn.failed': '{n} 次失败',
  'turn.expand': '点击查看详情',
  'turn.args': '参数',
  'turn.result': '结果',
  'turn.empty': '这一轮没有工具调用',
  'timeline.title': '时间线',
  'timeline.user': '你',
  'timeline.assistant': '模型',
  'timeline.tool': '工具',
  'timeline.turnN': '第 {n} 轮',
  'overview.title': '概览',
  'overview.status': '状态',
  'overview.at': '位置',
  'overview.elapsed': '已运行',
  'overview.callsTurn': '本轮调用（回合）',
  'overview.callsTotal': '累计调用（会话）',
  'overview.failures': '失败（会话）',
  'overview.tools': '可用工具',
  'overview.toolsUsed': '已用到 {n} 种',
  'overview.atValue': '#{turn} · 第 {step} 步',
  'overview.turnOnly': '#{turn}',

  // 模块二：正在跑
  'running.title': '正在跑',
  'running.empty': '现在没有在跑的动作',
  'running.started': '已跑 {s} 秒',

  // 模块三：动作日志
  'log.title': '动作日志（本会话最近 8 次）',
  'log.filterAll': '最近 {n} 次',
  'log.filterFailed': '只看失败 {n}',
  'log.filterEmpty': '没有符合条件的记录',
  'log.time': '时间',
  'log.tool': '工具',
  'log.did': '干了什么',
  'log.took': '耗时',
  'log.result': '结果',

  // 模块四：最近动静
  'recent.title': '最近动静',

  // 模块五：运行状况（这个视图自己的健康度）
  'health.title': '运行状况',
  'health.folded': '已折叠事件',
  'health.ignored': '已忽略（会话管理类）',
  'health.unknown': '未知类型',
  'health.frames': '收到流式帧',
  'health.agents': '已接管 agent',
  'health.registry': '注册表可见',
  'health.unreachable': '不可达',
  'health.deltas': '流式增量',
  'health.deltasValue': '接受 {ok} · 丢弃 {dropped}',
  'health.lastData': '数据更新',
  'health.silence': '{s} 秒前',
  'health.stale': '已 {s} 秒没有新数据',

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
  'view.tab': 'Activity',
  'view.empty': 'This session has no actions yet.',

  'head.toolRunning': 'Tool in use',
  'head.toolLast': 'Last tool used',
  'head.toolNone': 'No tool used yet',
  'axis.title': 'Turns as time (left to right)',
  'axis.turn': 'turn {n}',
  'axis.summary': '{turns} turns · {calls} calls · {failures} failed · {tools} tools offered ({used} used)',
  'turn.tools': '{n} tools',
  'turn.failed': '{n} failed',
  'turn.expand': 'click for details',
  'turn.args': 'arguments',
  'turn.result': 'result',
  'turn.empty': 'no tool calls in this turn',
  'timeline.title': 'Timeline',
  'timeline.user': 'you',
  'timeline.assistant': 'model',
  'timeline.tool': 'tool',
  'timeline.turnN': 'turn {n}',
  'overview.title': 'Overview',
  'overview.status': 'State',
  'overview.at': 'Position',
  'overview.elapsed': 'Elapsed',
  'overview.callsTurn': 'Calls (this turn)',
  'overview.callsTotal': 'Calls (session)',
  'overview.failures': 'Failures (session)',
  'overview.tools': 'Tools offered',
  'overview.toolsUsed': '{n} used',
  'overview.atValue': '#{turn} · step {step}',
  'overview.turnOnly': '#{turn}',

  'running.title': 'Running now',
  'running.empty': 'Nothing is running right now',
  'running.started': '{s}s so far',

  'log.title': 'Activity log (last 8 this session)',
  'log.filterAll': 'Last {n}',
  'log.filterFailed': 'Failures only {n}',
  'log.filterEmpty': 'No record matches this filter',
  'log.time': 'time',
  'log.tool': 'tool',
  'log.did': 'what it did',
  'log.took': 'took',
  'log.result': 'result',

  'recent.title': 'Just happened',

  'health.title': 'Panel health',
  'health.folded': 'Events folded',
  'health.ignored': 'Ignored (session setup)',
  'health.unknown': 'Unknown types',
  'health.frames': 'Stream frames',
  'health.agents': 'Agents attached',
  'health.registry': 'Registry size',
  'health.unreachable': 'unreachable',
  'health.deltas': 'Stream deltas',
  'health.deltasValue': '{ok} kept · {dropped} dropped',
  'health.lastData': 'Last data',
  'health.silence': '{s}s ago',
  'health.stale': 'no new data for {s}s',

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

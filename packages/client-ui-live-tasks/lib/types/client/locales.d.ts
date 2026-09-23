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
export declare const NS = "liveTasks";
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    readonly 'view.tab': '活动';
    readonly 'view.empty': '本会话还没有动作。';
    readonly 'head.toolRunning': '正在用的工具';
    readonly 'head.toolLast': '最近用的工具';
    readonly 'head.toolNone': '还没有用过工具';
    readonly 'bar.search': '搜索轨迹';
    readonly 'bar.expandAll': '展开全部';
    readonly 'bar.collapseAll': '收起全部';
    readonly 'bar.failedOnly': '只看失败';
    readonly 'bar.scrollHint': '横向可滚动';
    readonly 'detail.none': '（没有可显示的内容）';
    readonly 'detail.content': '内容';
    readonly 'detail.timing': '计时';
    readonly 'detail.close': '关闭详情';
    readonly 'timing.ended': '结束时间';
    readonly 'turn.windowOnly': '更早的明细未保留（仅保留最近 {n} 行）';
    readonly 'detail.schema': 'Schema';
    readonly 'detail.schemaUnavailable': 'Schema 不可用';
    readonly 'timing.ms': '毫秒';
    readonly 'timing.source': '计时来源';
    readonly 'timing.sourceSession': '会话时间戳';
    readonly 'timeline.toolCallsOnly': '（仅工具调用）';
    readonly 'detail.purpose': '说明';
    readonly 'row.called': '调用: ';
    readonly 'detail.name': '名称';
    readonly 'detail.entryId': '插件 ID';
    readonly 'usage.line': '本会话 {total} tok · 输入 {input} · 输出 {output} · 缓存读取 {cache}（{pct}%）';
    readonly 'usage.unknown': '本会话还没有用量报告';
    readonly 'usage.turn': '{t} tok';
    readonly 'axis.title': '轮次横轴（时间向右）';
    readonly 'axis.titleWindow': '轮次横轴（最近 {shown} 轮，共 {total} 轮）';
    readonly 'axis.turn': '第 {n} 轮';
    readonly 'axis.summary': '本会话 {turns} 轮 · {calls} 次调用 · 失败 {failures} · 可用工具 {tools}（用到 {used} 种）';
    readonly 'turn.stepN': '第 {n} 步';
    readonly 'bar.aria': '活动工具栏';
    readonly 'bar.durationMode': '时长';
    readonly 'bar.useActual': '使用实际时长';
    readonly 'bar.useEqual': '使用等宽操作';
    readonly 'bar.turnsMode': '轮次';
    readonly 'bar.callsMode': '调用';
    readonly 'bar.expandCalls': '展开所有调用';
    readonly 'bar.collapseCalls': '收起所有调用';
    readonly 'bar.searchPlaceholder': '搜索';
    readonly 'detail.overview': '概述';
    readonly 'timing.duration': '时长';
    readonly 'timing.started': '开始时间';
    readonly 'turn.tools': '{n} 个工具';
    readonly 'turn.failed': '{n} 次失败';
    readonly 'turn.expand': '点击查看详情';
    readonly 'turn.args': '参数';
    readonly 'turn.result': '结果';
    readonly 'turn.empty': '这一轮没有工具调用';
    readonly 'lane.input': '输入';
    readonly 'lane.model': '模型';
    readonly 'lane.tools': '工具';
    readonly 'lane.you': '你';
    readonly 'lane.context': '上下文';
    readonly 'bar.duration': '时长';
    readonly 'bar.clock': '实际时间';
    readonly 'bar.collapseTurns': '收起轮次';
    readonly 'bar.clearRange': '清除选择';
    readonly 'bar.rangeHint': '在时间图上拖动可框选';
    readonly 'bar.expandTurns': '展开轮次';
    readonly 'timeline.title': '时间线';
    readonly 'timeline.user': '你';
    readonly 'timeline.assistant': '模型';
    readonly 'timeline.tool': '工具';
    readonly 'timeline.turnN': '第 {n} 轮';
    readonly 'overview.title': '概览';
    readonly 'overview.status': '状态';
    readonly 'overview.at': '位置';
    readonly 'overview.elapsed': '已运行';
    readonly 'overview.callsTurn': '本轮调用（回合）';
    readonly 'overview.callsTotal': '累计调用（会话）';
    readonly 'overview.failures': '失败（会话）';
    readonly 'overview.tools': '可用工具';
    readonly 'overview.toolsUsed': '已用到 {n} 种';
    readonly 'overview.atValue': '#{turn} · 第 {step} 步';
    readonly 'overview.turnOnly': '#{turn}';
    readonly 'running.title': '正在跑';
    readonly 'running.empty': '现在没有在跑的动作';
    readonly 'running.started': '已跑 {s} 秒';
    readonly 'log.title': '动作日志（本会话最近 8 次）';
    readonly 'log.filterAll': '最近 {n} 次';
    readonly 'log.filterFailed': '只看失败 {n}';
    readonly 'log.filterEmpty': '没有符合条件的记录';
    readonly 'log.time': '时间';
    readonly 'log.tool': '工具';
    readonly 'log.did': '干了什么';
    readonly 'log.took': '耗时';
    readonly 'log.result': '结果';
    readonly 'recent.title': '最近动静';
    readonly 'health.title': '运行状况';
    readonly 'health.folded': '已折叠事件';
    readonly 'health.ignored': '已忽略（会话管理类）';
    readonly 'health.unknown': '未知类型';
    readonly 'health.frames': '收到流式帧';
    readonly 'health.agents': '已接管 agent';
    readonly 'health.registry': '注册表可见';
    readonly 'health.unreachable': '不可达';
    readonly 'health.deltas': '流式增量';
    readonly 'health.deltasValue': '接受 {ok} · 丢弃 {dropped}';
    readonly 'health.lastData': '数据更新';
    readonly 'health.silence': '{s} 秒前';
    readonly 'health.stale': '已 {s} 秒没有新数据';
    readonly 'status.ok': '完成';
    readonly 'status.failed': '失败';
    readonly 'status.running': '进行中';
    readonly 'phase.running': '正在干活';
    readonly 'phase.tool': '等工具返回';
    readonly 'phase.idle': '空闲';
    readonly 'phase.ended': '已结束';
    readonly 'time.seconds': '{s} 秒';
    readonly 'time.justNow': '刚刚';
    readonly 'time.agoSeconds': '{s} 秒前';
    readonly 'time.agoMinutes': '{m} 分前';
    readonly 'event.turnStart': '开始处理';
    readonly 'event.turnEnd': '处理结束';
    readonly 'event.userMessage': '收到你的消息';
    readonly 'event.assistantMessage': '模型回复';
    readonly 'event.toolCall': '调用 {name}';
    readonly 'event.toolResult': '{name} 返回';
};
/** Key set of the Chinese dictionary. */
export type LiveTaskKey = keyof typeof zh;
/** English dictionary, key-identical to the Chinese source of truth. */
export declare const en: Record<LiveTaskKey, string>;

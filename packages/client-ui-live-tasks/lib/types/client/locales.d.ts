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
    readonly 'view.tab': '任务';
    readonly 'view.empty': '本会话还没有动作。';
    readonly 'overview.title': '概览';
    readonly 'overview.status': '状态';
    readonly 'overview.at': '位置';
    readonly 'overview.elapsed': '已运行';
    readonly 'overview.calls': '工具调用';
    readonly 'overview.failures': '失败';
    readonly 'overview.atValue': '#{turn} · 第 {step} 步';
    readonly 'overview.turnOnly': '#{turn}';
    readonly 'running.title': '正在跑';
    readonly 'running.empty': '现在没有在跑的动作';
    readonly 'running.started': '已跑 {s} 秒';
    readonly 'log.title': '动作日志';
    readonly 'log.filterAll': '全部 {n}';
    readonly 'log.filterFailed': '只看失败 {n}';
    readonly 'log.filterEmpty': '没有符合条件的记录';
    readonly 'log.time': '时间';
    readonly 'log.tool': '工具';
    readonly 'log.did': '干了什么';
    readonly 'log.took': '耗时';
    readonly 'log.result': '结果';
    readonly 'recent.title': '最近动静';
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

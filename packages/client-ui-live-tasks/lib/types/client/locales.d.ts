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
export declare const NS = "liveTasks";
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    readonly 'view.tab': '任务';
    readonly 'view.title': '本会话在做什么';
    readonly 'view.empty': '本会话还没有动作。';
    readonly 'section.running': '正在跑';
    readonly 'section.actions': '干过什么';
    readonly 'section.recent': '最近动静';
    readonly 'col.tool': '工具';
    readonly 'col.did': '干了什么';
    readonly 'col.result': '结果';
    readonly 'status.ok': '完成';
    readonly 'status.failed': '失败';
    readonly 'status.running': '进行中';
    readonly 'time.at': '时间';
    readonly 'time.durationSeconds': '{s} 秒';
    readonly 'time.runningFor': '已运行 {s} 秒';
    readonly 'tool.none': '现在没有在跑的动作';
    readonly 'phase.running': '正在干活';
    readonly 'phase.tool': '等工具返回';
    readonly 'phase.idle': '空闲';
    readonly 'phase.ended': '已结束';
    readonly 'event.turnStart': '开始处理';
    readonly 'event.turnEnd': '处理结束';
    readonly 'event.stepStart': '开始第 {n} 步';
    readonly 'event.stepEnd': '第 {n} 步结束';
    readonly 'event.userMessage': '收到你的消息';
    readonly 'event.assistantMessage': '模型回复';
    readonly 'event.toolCall': '调用 {name}';
    readonly 'event.toolResult': '{name} 返回';
    readonly 'event.other': '其他活动';
};
/** Key set of the Chinese dictionary. */
export type LiveTaskKey = keyof typeof zh;
/** English dictionary, key-identical to the Chinese source of truth. */
export declare const en: Record<LiveTaskKey, string>;

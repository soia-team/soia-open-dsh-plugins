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
export declare const NS = "liveTasks";
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    readonly 'view.tab': '任务';
    readonly 'view.title': '会话任务状态';
    readonly 'view.empty': '本会话当前没有进行中的任务。';
    readonly 'panel.empty': '本次会话还没有事件。';
    readonly 'row.phase': '状态';
    readonly 'row.turn': '回合';
    readonly 'row.step': '步骤';
    readonly 'row.lastTool': '最后工具调用';
    readonly 'row.toolCalls': '本轮工具调用数';
    readonly 'row.lastEvent': '最后事件';
    readonly 'row.endedReason': '结束原因';
    readonly 'phase.running': '运行中';
    readonly 'phase.tool': '等待工具结果';
    readonly 'phase.idle': '空闲';
    readonly 'phase.ended': '已结束';
    readonly 'tool.open': '进行中';
    readonly 'tool.failed': '失败';
    readonly 'tool.done': '已完成';
    readonly 'value.none': '无';
    readonly 'value.openCount': '{count} 个进行中';
};
/** English dictionary, key-identical to the Chinese source of truth. */
export declare const en: Record<LiveTaskKey, string>;
/** Key domain of the `liveTasks` namespace (`zh` is the source of truth). */
export type LiveTaskKey = keyof typeof zh;

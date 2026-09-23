/**
 * `ui-live-tasks` — browser half. Contributes one conversation view (a peer of
 * the built-in 对话 / 轨迹 tabs) that renders the host-computed `liveTask`
 * projection value of the current session.
 *
 * This half deliberately owns no transport: the host folds the state, the
 * session-projection registry mirrors whole values into the page, and this
 * plugin reads the seat the standard slot kit already hands it. A package that
 * opened its own RPC for state the projection registry exists to carry would be
 * re-implementing the framework.
 *
 * @module soia-dsh-client-ui-live-tasks/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { LiveTaskKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Live-task panel copy. */
        liveTasks: LiveTaskKey;
    }
}
/**
 * Client services this half needs ready before it activates.
 *
 * `slots` and `locale` are the two it calls directly. `sessions` and
 * `uiConversation` are what the standard slot kit is assembled from: the kit
 * hands the component `useProjection`, which reads the session-projection
 * mirror, and the header slot itself belongs to the conversation surface. The
 * official client halves that read a projection declare the same two (see
 * `dsh-client-ui-goal`), and without them the kit cannot supply the hook.
 */
import type { SessionEventSourceLike } from './LiveTasksView.ts';
/** The session face this view consumes, declared structurally (see `inject`). */
export interface SessionFaceLike {
    readonly eventSource: SessionEventSourceLike;
    loadOlder(): Promise<void>;
}
/** Bundle rows as the remote face reports them (structural, see `inject`). */
export interface BundleInfoLike {
    readonly name: string;
    readonly version?: string;
    readonly description?: string;
    readonly enabled: boolean;
    readonly rows?: readonly {
        readonly rowId: string;
        readonly moduleName: string;
        readonly entryId?: string;
    }[];
}
/** What the drawer shows when 插件 ID is clicked. */
export interface PluginInfoCard {
    readonly pkg: string;
    readonly version: string | null;
    readonly description: string | null;
    readonly enabled: boolean;
    readonly entryId: string;
}
export declare const inject: string[];
/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;

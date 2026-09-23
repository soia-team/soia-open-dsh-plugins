import type { PluginInfoCard } from './index.ts';
import type { LiveTaskKey } from './locales.ts';
/** Props the conversation view slot hands a session-scoped view. */
export interface LiveTasksViewProps {
    /** Host-computed projection value for this session, if the unit has one. */
    useProjection: (key: string) => unknown;
    /** Namespace-bound translator for this view's copy. */
    t: (key: LiveTaskKey, params?: Record<string, string | number>) => string;
    /**
     * Selector hook over the session snapshot (the shell's standard kit).
     *
     * Supplies the paging flags; the offline preview passes a stub, so every read
     * must go through the selector rather than assuming the field exists.
     */
    useSession: <Selected>(selector: (snapshot: SessionSnapshotLike) => Selected) => Selected;
    /**
     * Resident event window for the client-side archive fold, injected by the
     * session-scoped registration. Absent in the offline preview, where the view
     * falls back to the host projection alone.
     */
    eventSource?: SessionEventSourceLike;
    /** Pull one older history page; injected beside the event source. */
    loadOlder?: () => Promise<void>;
    /** Look up the bundle a tool comes from (remote plugin manager); optional. */
    loadPluginInfo?: (toolName: string) => Promise<PluginInfoCard | null>;
    /** Tool → package rows for the roster's default filter; optional. */
    listToolBundles?: () => Promise<{
        tool: string;
        pkg: string;
        entryId: string;
    }[]>;
}
/** The window snapshot shape the view consumes — declared structurally so the
 *  browser bundle does not need a type-only import from the host SDK. */
interface SessionWindowLike {
    readonly entries: readonly ({
        readonly type: 'event';
        readonly event: unknown;
    } | {
        readonly type: 'transient';
        readonly event: unknown;
    })[];
    readonly hasMore: boolean;
    readonly revision: number;
    /** How the latest revision arrived — append is the live hot path. */
    readonly change: {
        readonly kind: 'append' | 'prepend' | 'replace';
        readonly entries: readonly {
            readonly type: string;
            readonly event: unknown;
        }[];
    } | {
        readonly kind: 'settle-assistant';
    };
}
/** Observable face of one session's resident event window. */
export interface SessionEventSourceLike {
    subscribe(listener: () => void): () => void;
    getSnapshot(): SessionWindowLike;
}
/** Selector target for the paging flags, matching the shell's session snapshot. */
interface SessionSnapshotLike {
    readonly hasMore: boolean;
    readonly loadingOlder: boolean;
    readonly openState?: 'cold' | 'loading' | 'open' | 'error';
}
/**
 * The 运行状况 tab: the panel's own telemetry gets its own seat, so the timeline
 * stays a timeline. Everything the old bottom block reported lives here in full
 * — session totals, the tool roster (our packages first), usage, freshness, and
 * the fold's internal counters — without competing for the activity view's space.
 * @param props - the same standard kit and injected sources as the activity view.
 * @returns the telemetry panel, or the shared empty state.
 */
export declare function LiveStatusView({ useProjection, t, useSession, eventSource, listToolBundles }: LiveTasksViewProps): JSX.Element;
export declare function LiveTasksView({ useProjection, t, useSession, eventSource, loadOlder, loadPluginInfo, listToolBundles }: LiveTasksViewProps): JSX.Element;
export {};

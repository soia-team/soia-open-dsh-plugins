import type { LiveTaskKey } from './locales.ts';
/** Props the conversation view slot hands a session-scoped view. */
export interface LiveTasksViewProps {
    /** Host-computed projection value for this session, if the unit has one. */
    useProjection: (key: string) => unknown;
    /** Namespace-bound translator for this view's copy. */
    t: (key: LiveTaskKey) => string;
}
/**
 * Render the live task view for the current session.
 * @param props - projection hook and translator from the slot kit.
 * @returns the view body, or an explicit empty state.
 */
export declare function LiveTasksView({ useProjection, t }: LiveTasksViewProps): JSX.Element;

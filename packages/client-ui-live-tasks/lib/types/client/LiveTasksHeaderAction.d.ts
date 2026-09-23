import type { LiveTaskKey } from './locales.ts';
/** Props the header action slot hands a session-scoped occupant. */
export interface LiveTasksHeaderActionProps {
    /** Host-computed projection value for this session, if the unit has one. */
    useProjection: (key: string) => unknown;
    /** Namespace-bound translator for this copy. */
    t: (key: LiveTaskKey, params?: Record<string, string | number>) => string;
}
/**
 * Render the running-tool indicator.
 * @param props - projection hook and translator from the slot kit.
 * @returns the indicator, or null when there is nothing to report.
 */
export declare function LiveTasksHeaderAction({ useProjection, t }: LiveTasksHeaderActionProps): JSX.Element | null;

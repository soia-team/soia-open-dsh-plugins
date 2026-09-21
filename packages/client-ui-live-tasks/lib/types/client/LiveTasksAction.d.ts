import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { NS } from './locales.ts';
/** Full props for the session-header live-task action. */
export type LiveTasksActionProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS>;
/**
 * Session-header action and popover for this session's task state.
 * @param props - runtime slot currency plus the namespace translator.
 * @returns the trigger and its popover, or null when there is nothing to show.
 */
export declare function LiveTasksAction({ useProjection, t }: LiveTasksActionProps): JSX.Element | null;

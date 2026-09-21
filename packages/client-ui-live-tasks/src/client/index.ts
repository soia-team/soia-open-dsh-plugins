/**
 * `ui-live-tasks` — browser half. Contributes one session-header action that
 * renders the host-computed `liveTask` projection value of the current session.
 *
 * This half deliberately owns no transport: the host folds the state, the
 * session-projection registry mirrors whole values into the page, and this
 * plugin reads the seat the standard slot kit already hands it. A package that
 * opened its own RPC for state the projection registry exists to carry would be
 * re-implementing the framework.
 *
 * @module soia-dsh-client-ui-live-tasks/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

// oxlint-disable import/no-empty-named-blocks, unicorn/require-module-specifiers -- a type-only import with no bindings is TypeScript's way to say "load this module for its declaration merges"; see the note below.
//
// Contract loads. A `declare module` augmentation merges into the program, not
// into one file, but it only merges if its declaring module is part of the
// program at all. The official monorepo gets that for free from one client-wide
// aggregate tsconfig; a package compiled on its own must name the contracts it
// extends. These are type-only, so they add nothing to the browser bundle:
//   - ui-conversation owns the `conversation.session.header.actions` SlotMap entry
//   - ui-session supplies the session standard kit (useProjection, useSession)
//   - ui-renderer supplies `ctx.slots`
//   - locale supplies `ctx.locale`
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import type { LiveTaskKey } from './locales.ts'
import { LiveTasksAction } from './LiveTasksAction.tsx'
import { en, NS, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Live-task panel copy. */
    liveTasks: LiveTaskKey
  }
}

/**
 * Client services this half touches: the slot registry it contributes the
 * header action to, and the locale registry that owns its dictionaries.
 */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-live-tasks: dictionaries')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'live-tasks',
    // After the background-job list (order 20): job state and task state are
    // adjacent read-only session facts, and this one is the broader summary.
    order: 30,
    locale: NS,
  }, LiveTasksAction))
}

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
import { LiveTasksView } from './LiveTasksView.tsx'
import { en, NS, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Live-task panel copy. */
    liveTasks: LiveTaskKey
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
export const inject = ['slots', 'locale', 'sessions', 'uiConversation']

/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Namespace-bound translator: the registration's `label` is a function the
  // shell calls when it builds the view switcher, so the tab text follows the
  // active locale the same way the built-in views do.
  const t = ctx.locale.bind(NS) as unknown as (key: LiveTaskKey) => string

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-live-tasks: dictionaries')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'live-tasks',
    // After 对话 (0) and 轨迹 (10): the task view is a read-only companion to
    // them, not a replacement for either.
    order: 20,
    label: () => t('view.tab'),
    locale: NS,
  }, LiveTasksView))
}

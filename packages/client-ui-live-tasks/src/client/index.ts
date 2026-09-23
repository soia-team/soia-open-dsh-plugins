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
import { LiveTasksHeaderAction } from './LiveTasksHeaderAction.tsx'
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
import type { SessionEventSourceLike } from './LiveTasksView.ts'

/** The session face this view consumes, declared structurally (see `inject`). */
export interface SessionFaceLike {
  readonly eventSource: SessionEventSourceLike
  loadOlder(): Promise<void>
}

/** Bundle rows as the remote face reports them (structural, see `inject`). */
export interface BundleInfoLike {
  readonly name: string
  readonly version?: string
  readonly description?: string
  readonly enabled: boolean
  readonly rows?: readonly { readonly rowId: string, readonly moduleName: string, readonly entryId?: string }[]
}

/** What the drawer shows when 插件 ID is clicked. */
export interface PluginInfoCard {
  readonly pkg: string
  readonly version: string | null
  readonly description: string | null
  readonly enabled: boolean
  readonly entryId: string
}

/**
 * Tool name a patch row registers, by the ecosystem's naming law.
 *
 * `tool-check-ui-size` / `dsh-tool-bash` / `soia-dsh-tool-check-ui-size` all end
 * in the dashed tool name; the row id wins when present.
 * @param id - a row id or module name.
 * @returns the snake-cased tool name, or null when the id names no tool.
 */
function deriveToolName(id: string): string | null {
  const tail = id.split('/').pop() ?? id
  const match = /^(?:soia-)?(?:dsh-)?tool-(.+)$/.exec(tail)
  if (match === null) return null
  return (match[1] ?? '').replaceAll('-', '_')
}

export const inject = ['slots', 'locale', 'sessions', 'uiConversation', 'remote', 'remote.pluginManager']

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
    // Session-scoped extras, the same shape the trajectory view registers: the
    // resident event window (for the client-side archive fold) and the page pull
    // that extends it. The view degrades to the host projection when either is
    // absent — the offline preview passes neither.
    inject: (sessionId: string) => {
      // Structural cast: the program carries two `sessions` declaration merges —
      // the host's `SessionStore` (from `dsh-session`) wins the union and hides
      // the client face's `binding`. The runtime object is the client controller
      // (the shell injects it), so the cast states the shape we use instead of
      // importing a package this workspace cannot resolve the way the official
      // monorepo does.
      const sessions = ctx.sessions as unknown as {
        binding(id: string): { session?: SessionFaceLike } | undefined
      }
      const session = sessions.binding(sessionId)?.session
      // Structural cast again: `remote.pluginManager`'s typert face is generated
      // per install, and this workspace cannot resolve its package the way the
      // official monorepo does. The shape used here is what the manager page
      // itself calls.
      const remote = (ctx as unknown as {
        remote?: { pluginManager?: { listBundles(): Promise<{ ok: boolean, value?: BundleInfoLike[] }> } }
      }).remote
      return {
        ...(session === undefined
          ? {}
          : { eventSource: session.eventSource, loadOlder: () => session.loadOlder() }),
        loadPluginInfo: async (toolName: string): Promise<PluginInfoCard | null> => {
          const result = await remote?.pluginManager?.listBundles()
          if (result === undefined || !result.ok || result.value === undefined) return null
          for (const bundle of result.value) {
            for (const row of bundle.rows ?? []) {
              const derived = deriveToolName(row.rowId) ?? deriveToolName(row.moduleName)
              if (derived === toolName) {
                return {
                  pkg: bundle.name,
                  version: bundle.version ?? null,
                  description: bundle.description ?? null,
                  enabled: bundle.enabled,
                  entryId: row.entryId ?? row.rowId,
                }
              }
            }
          }
          return null
        },
      }
    },
  }, LiveTasksView))
  // A second, smaller surface: the running tool in the session header, readable
  // from the conversation view as well. The full panel is one tab away; the name
  // of the tool should not require going there.
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'live-tasks',
    order: 30,
    locale: NS,
  }, LiveTasksHeaderAction))
}

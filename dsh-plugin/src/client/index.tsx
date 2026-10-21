/**
 * Browser half of the prompt-enhance plugin: registers the composer
 * enhance button (conversation.input.right), the dock line
 * (conversation.input.dock), the zh/en dictionaries, the settings mirror,
 * the configurable enhance shortcut, and the Ctrl+Z restore. Failure policy mirrors the
 * describe-image family: every optional wiring failure is caught and
 * logged-never-thrown, because the web shell fails the whole boot when a
 * plugin apply throws.
 * @module dsh-prompt-enhance/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { EnhanceButton } from './EnhanceButton'
import { UndoBar } from './UndoBar'
import * as ui from './ui-state'
import { dictionaries, NS } from './locales'
import { ensureStyles } from './styles'
import { matchesShortcut, parseShortcut } from './shortcut'
import { decodeClientSettings, getClientSettings, setClientSettings } from './settings'
import { registerTierPersist } from './tier-store'
import type { Tier } from '../tiers'

/** Locale namespace of the browser half. */
export { NS }

// No hard service dependencies. Every service this half touches (`settingsScope`
// from the optional settings surface, `slots` and `locale` from the UI packages
// a given profile may or may not bundle) is reached through `ctx.inject`, which
// starts the wiring only if and when the service actually mounts. A service
// named here instead would make this entry sit `pending` forever on a profile
// that lacks it — and DSH treats a pending entry as a boot failure
// ("web boot: 1 entry did not activate"), taking the whole GUI down with it.
// The cost of that choice is degraded, never broken: a profile with no settings
// surface keeps the bundled default mirror, and one with no locale service
// renders dictionary keys instead of copy.
export const inject: string[] = []

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ensureStyles()

  // Dictionaries arrive with the locale service, which is optional here: a
  // profile without it renders dictionary keys instead of localized copy, but
  // the plugin must not block boot over that.
  ctx.inject(['locale'], (localeCtx: ClientContext) => {
    ctx.effect(() => {
      try {
        return localeCtx.locale.register(NS, dictionaries)
      } catch {
        return () => {}
      }
    }, 'dsh-prompt-enhance: dictionaries')
  })

  // Baseline before anything optional mounts: the bundled mirror equals the
  // host `DEFAULT_CONFIG`, so a profile without the settings surface still gets
  // a working button, guards, and shortcut instead of an unset mirror.
  setClientSettings(decodeClientSettings(undefined))

  // The settings mirror: re-read on every committed change so the button,
  // the guards, and the shortcut follow Settings → 插件配置 live. The
  // subscription disposer rides ctx.effect (ctx.inject only runs the
  // callback; it does not manage a returned disposer).
  ctx.inject(['settingsScope'], (settingsCtx: ClientContext) => {
    const scope = settingsCtx.settingsScope.bind({ namespace: NS, decode: decodeClientSettings })
    const sync = (): void => {
      setClientSettings(scope.getSnapshot().value ?? decodeClientSettings(undefined))
    }
    sync()
    ctx.effect(() => scope.subscribe(sync), 'dsh-prompt-enhance: settings mirror')
    // The tier picker's "设为默认档" writes back through the same scope, so the
    // choice persists without a second RPC surface. A profile without the
    // settings service simply keeps the picker session-scoped.
    registerTierPersist((tier: Tier) => scope.set('defaultTier', tier))
  })

  ctx.inject(['slots'], (slotsCtx: ClientContext) => {
    const slots = slotsCtx.slots
    return slots.inject('conversation.input.right', () => {
      try {
        return slots.register(
          { name: 'conversation.input.right', id: 'prompt-enhance', order: 60, locale: NS },
          EnhanceButton,
        )
      } catch {
        return () => {}
      }
    })
  })

  ctx.inject(['slots'], (slotsCtx: ClientContext) => {
    const slots = slotsCtx.slots
    return slots.inject('conversation.input.dock', () => {
      try {
        return slots.register(
          { name: 'conversation.input.dock', id: 'prompt-enhance-undo', order: 90, locale: NS },
          UndoBar,
        )
      } catch {
        return () => {}
      }
    })
  })

  // The configurable shortcut: acts on the composer the user is working in;
  // never swallows keys unless the exact combo matches.
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      const combo = parseShortcut(getClientSettings().shortcut)
      if (!matchesShortcut(event, combo)) return
      const target = ui.shortcutTarget()
      if (target === undefined) return
      event.preventDefault()
      event.stopPropagation()
      target()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, 'dsh-prompt-enhance: shortcut')

  // Ctrl+Z restores the pre-enhance draft, but only while the composer still
  // holds exactly what the enhancement put there. `ui.undoTarget()` returns
  // false in every other situation, and then the event is left alone so the
  // browser's own undo (per-character typing history) keeps working — stealing
  // Ctrl+Z unconditionally would break ordinary text editing.
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'z') return
      if (!ui.undoTarget()) return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, 'dsh-prompt-enhance: undo shortcut')
}

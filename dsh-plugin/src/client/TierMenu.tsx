/**
 * The tier picker that sits LEFT of the ✨ enhance button in the composer.
 *
 * One capsule showing the tier in force for this session; clicking it opens a
 * small popover with the four tiers, a "结合上下文" toggle, and a "设为默认档"
 * action. The picker never sends a request itself — it only writes selection
 * state that `EnhanceButton` reads when the user clicks ✨ (or presses the
 * shortcut), so switching tiers costs nothing and is instantly reversible.
 *
 * Everything here is defensive about the surrounding host: the popover is
 * positioned with plain CSS (`position: absolute` inside a `position: relative`
 * wrapper), it closes on outside pointerdown and on Escape, and it renders
 * nothing when the plugin is disabled.
 * @module dsh-prompt-enhance/client/TierMenu
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { TIERS, type Tier } from '../tiers'
import { getClientSettings, subscribeClientSettings } from './settings'
import {
  canPersistTier,
  effectiveTier,
  effectiveUseContext,
  getVersion,
  persistDefaultTier,
  selectTier,
  selectUseContext,
  subscribe,
} from './tier-store'

/** Props of the picker: a locale seat plus the session key it acts on. */
export interface TierMenuProps {
  /** Session key the selection applies to (the composer's `uiKey`). */
  sessionKey: string
  /** Localized copy. */
  t: PropsLocale<'prompt-enhance'>['t']
}

/** Short badge glyph per tier — the capsule stays one glyph wide. */
const BADGE: Record<Tier, string> = {
  base: '基',
  standard: '标',
  professional: '专',
  system: '系',
}

/** Locale key of each tier's display name. */
const NAME_KEY = {
  base: 'tier.base',
  standard: 'tier.standard',
  professional: 'tier.professional',
  system: 'tier.system',
} as const satisfies Record<Tier, string>

/** Locale key of each tier's one-line explanation. */
const HINT_KEY = {
  base: 'tier.base.hint',
  standard: 'tier.standard.hint',
  professional: 'tier.professional.hint',
  system: 'tier.system.hint',
} as const satisfies Record<Tier, string>

/**
 * The tier capsule + popover.
 * @param props - session key and locale seat.
 * @returns the picker element.
 */
export function TierMenu({ sessionKey, t }: TierMenuProps): ReactNode {
  // Re-render on selection changes; the version counter is the snapshot, the
  // selections themselves are read through the store's accessors.
  useSyncExternalStore(subscribe, getVersion)
  const masterContext = useSyncExternalStore(subscribeClientSettings, getClientSettings).contextAware
  const canPin = canPersistTier()
  const tier = effectiveTier(sessionKey)
  const useContext = effectiveUseContext(sessionKey)
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // "已设为默认档" is transient feedback: it is cleared when the popover closes
  // so reopening never shows a stale confirmation.
  const [pinned, setPinned] = useState(false)

  /** Close the popover (the native `details` element owns the open state). */
  const close = useCallback((): void => {
    if (detailsRef.current !== null) detailsRef.current.open = false
    setPinned(false)
  }, [])

  // Outside pointerdown / Escape close the popover. `details` has no built-in
  // light-dismiss, and a menu that survives a click elsewhere reads as stuck.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const root = detailsRef.current
      if (root === null || !root.open) return
      if (event.target instanceof Node && root.contains(event.target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [close])

  // Move focus into the popover when it opens: the composer is keyboard-driven
  // (the shortcut opens the same action), so a menu that traps nothing but also
  // focuses nothing would need a mouse to reach its first item.
  useEffect(() => {
    const root = detailsRef.current
    if (root === null) return
    const onToggle = (): void => {
      if (!root.open) {
        setPinned(false)
        return
      }
      const first = menuRef.current?.querySelector('button')
      if (first instanceof HTMLElement) first.focus()
    }
    root.addEventListener('toggle', onToggle)
    return () => {
      root.removeEventListener('toggle', onToggle)
    }
  }, [])

  /**
   * Pick a tier for this session and close the popover.
   * @param next - the tier chosen.
   */
  const pick = useCallback((next: Tier): void => {
    selectTier(sessionKey, next)
    close()
  }, [sessionKey, close])

  /**
   * Toggle "结合上下文" for this session.
   * @param event - the checkbox change.
   */
  const toggleContext = useCallback((event: { target: { checked: boolean } }): void => {
    selectUseContext(sessionKey, event.target.checked === true)
  }, [sessionKey])

  /**
   * Persist the current tier as the plugin default (survives a reload and
   * applies to the shortcut and `/enhance` too). The picker stays open so the
   * confirmation is visible; the write is fire-and-forget because a failed
   * persist only loses the default, never the running session.
   */
  const pinDefault = useCallback((): void => {
    void persistDefaultTier(tier)
    setPinned(true)
  }, [tier])

  return (
    <details className="dsh-pe-tier" ref={detailsRef}>
      <summary
        className="dsh-pe-tier-btn"
        title={t('tier.current', { tier: t(NAME_KEY[tier]) })}
        aria-label={t('tier.current', { tier: t(NAME_KEY[tier]) })}
      >
        <span className="dsh-pe-tier-badge" aria-hidden>{BADGE[tier]}</span>
        <span className="dsh-pe-tier-caret" aria-hidden>▾</span>
      </summary>
      <div className="dsh-pe-tier-menu" role="menu" ref={menuRef}>
        <div className="dsh-pe-tier-title">{t('tier.menu.title')}</div>
        {TIERS.map((option) => (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={option === tier}
            className={`dsh-pe-tier-item${option === tier ? ' is-active' : ''}`}
            onClick={() => pick(option)}
          >
            <span className="dsh-pe-tier-item-head">
              <span className="dsh-pe-tier-badge" aria-hidden>{BADGE[option]}</span>
              <span className="dsh-pe-tier-item-name">{t(NAME_KEY[option])}</span>
            </span>
            <span className="dsh-pe-tier-item-hint">{t(HINT_KEY[option])}</span>
          </button>
        ))}
        <label
          className={`dsh-pe-tier-context${masterContext ? '' : ' is-locked'}`}
          title={masterContext ? t('tier.menu.context.hint') : t('tier.menu.context.locked')}
        >
          <input
            type="checkbox"
            checked={useContext}
            disabled={!masterContext}
            onChange={toggleContext}
          />
          <span>{t('tier.menu.context')}</span>
        </label>
        <div className="dsh-pe-tier-foot">
          {pinned ? (
            <span className="dsh-pe-tier-pinned" role="status">{t('tier.menu.default.done')}</span>
          ) : canPin ? (
            <button type="button" className="dsh-pe-tier-pin" onClick={pinDefault}>
              {t('tier.menu.default')}
            </button>
          ) : null}
        </div>
      </div>
    </details>
  )
}

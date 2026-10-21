/**
 * The tier picker that sits LEFT of the ✨ enhance button in the composer.
 *
 * The capsule shows the tier in force for this session. Opening it gives one row
 * per tier plus two verb-shaped controls:
 *
 * - click a row → that tier for **this conversation only** (held in
 *   `sessionStorage`, so a refresh keeps it and closing DSH drops it);
 * - tick the radio at the row's right edge → make that tier the **default** for
 *   every new conversation. 系统 is exempt: it is a whole system prompt, and the
 *   Windows hotkey layer refuses to make it a default for the same reason.
 *
 * The picker never sends a request itself — it only writes selection state that
 * `EnhanceButton` reads when the user clicks ✨ (or presses the shortcut), so
 * switching tiers costs nothing and is instantly reversible.
 * @module dsh-prompt-enhance/client/TierMenu
 */

import { useCallback, useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { TIERS, type Tier } from '../tiers'
import { getClientSettings, subscribeClientSettings } from './settings'
import {
  defaultContextOf,
  defaultTierOf,
  effectiveTier,
  effectiveUseContext,
  getVersion,
  hasSessionPick,
  selectTier,
  selectUseContext,
  sessionContextPick,
  setDefaultContext,
  setDefaultTier,
  subscribe,
  tierAllowsContext,
  tierCanBeDefault,
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
  const masterSettings = useSyncExternalStore(subscribeClientSettings, getClientSettings)
  const tier = effectiveTier(sessionKey)
  const useContext = effectiveUseContext(sessionKey)
  const pinnedDefault = defaultTierOf()
  const pinnedContext = defaultContextOf()
  const sessionContext = sessionContextPick(sessionKey)
  const temporary = hasSessionPick(sessionKey) && tier !== pinnedDefault
  // The radio reads "pinned" when a default exists at all; when the session
  // also carries its own pick that differs, it is temporarily overriding even
  // the default — which the footer language already covers for tiers.
  const contextIsPinned = pinnedContext !== undefined
  const contextIsOverridden = sessionContext !== undefined && sessionContext !== pinnedContext
  // Two independent reasons the row can be inert: the plugin-level master
  // switch, and the tier itself (基础 never takes history). Both are reported,
  // because a disabled checkbox with the wrong explanation is worse than none.
  const contextLock = !masterSettings.contextAware
    ? t('tier.menu.context.locked')
    : tierAllowsContext(tier)
      ? undefined
      : t('tier.menu.context.tierlocked')
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const titleId = useId()
  const groupName = `${useId()}-default`
  const menuRef = useRef<HTMLDivElement | null>(null)
  // 基础 has no context at all, so pinning a default there would promise a
  // state the next call ignores. Pinnable follows the row, not the session.
  const contextIsPinnable = tierAllowsContext(tier)

  /** Close the popover (the native `details` element owns the open state). */
  const close = useCallback((): void => {
    if (detailsRef.current !== null) detailsRef.current.open = false
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
      if (!root.open) return
      const first = menuRef.current?.querySelector('button')
      if (first instanceof HTMLElement) first.focus()
    }
    root.addEventListener('toggle', onToggle)
    return () => {
      root.removeEventListener('toggle', onToggle)
    }
  }, [])

  /**
   * Pick a tier for this session. The popover stays open on purpose: the two
   * decisions on screen (which tier, and whether it becomes the default) are
   * usually made in one visit, and the footer that reports "临时" only makes
   * sense while it is visible.
   * @param next - the tier chosen.
   */
  const pick = useCallback((next: Tier): void => {
    selectTier(sessionKey, next)
  }, [sessionKey])

  /**
   * Make a tier the default for every new conversation, and use it here too.
   * @param next - the tier to persist.
   */
  const makeDefault = useCallback((next: Tier): void => {
    if (!setDefaultTier(next)) return
    selectTier(sessionKey, next)
  }, [sessionKey])

  /**
   * Toggle "结合上下文" for this session.
   * @param event - the checkbox change.
   */
  const toggleContext = useCallback((event: { target: { checked: boolean } }): void => {
    selectUseContext(sessionKey, event.target.checked === true)
  }, [sessionKey])

  /**
   * Pin the context toggle as the default for every new conversation (or unpin
   * it when the same state is ticked again — the radio mirrors the tier rows).
   * @param next - the default on/off to persist.
   */
  const makeDefaultContext = useCallback((next: boolean): void => {
    if (defaultContextOf() === next) {
      setDefaultContext(undefined)
      return
    }
    setDefaultContext(next)
    selectUseContext(sessionKey, next)
  }, [sessionKey])

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
      <div className="dsh-pe-tier-menu" ref={menuRef}>
        <div className="dsh-pe-tier-title" id={titleId}>{t('tier.menu.title')}</div>
        <div className="dsh-pe-tier-legend">{t('tier.menu.legend')}</div>
        {/* A radio group, not a menu: the popover also holds checkbox and radio
            inputs, which a role="menu" container may not contain. */}
        <div role="radiogroup" aria-labelledby={titleId}>
          {TIERS.map((option) => {
            const pinnable = tierCanBeDefault(option)
            return (
              <div key={option} className={`dsh-pe-tier-row${option === tier ? ' is-active' : ''}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={option === tier}
                  aria-label={`${t(NAME_KEY[option])}：${t(HINT_KEY[option])}`}
                  className="dsh-pe-tier-item"
                  onClick={() => pick(option)}
                >
                  <span className="dsh-pe-tier-item-head">
                    <span className="dsh-pe-tier-badge" aria-hidden>{BADGE[option]}</span>
                    <span className="dsh-pe-tier-item-name">{t(NAME_KEY[option])}</span>
                    {/* Decoration for the checked state: the radio group
                        already exposes it, so this never carries information
                        on its own. */}
                    <span className="dsh-pe-tier-mark" aria-hidden>✓</span>
                  </span>
                  <span className="dsh-pe-tier-item-hint">{t(HINT_KEY[option])}</span>
                </button>
                <label
                  className={`dsh-pe-tier-default${pinnable ? '' : ' is-locked'}`}
                  title={pinnable ? t('tier.menu.default') : t('tier.menu.default.systemBlocked')}
                >
                  <input
                    type="radio"
                    name={groupName}
                    checked={option === pinnedDefault}
                    disabled={!pinnable}
                    onChange={() => makeDefault(option)}
                    aria-label={`${t('tier.menu.default')}：${t(NAME_KEY[option])}`}
                  />
                </label>
              </div>
            )
          })}
        </div>
        <div className={`dsh-pe-tier-context-row${contextLock === undefined ? '' : ' is-locked'}`}>
          <label
            className={`dsh-pe-tier-context${contextLock === undefined ? '' : ' is-locked'}`}
            title={contextLock ?? t('tier.menu.context.hint')}
          >
            <input
              type="checkbox"
              checked={useContext}
              disabled={contextLock !== undefined}
              onChange={toggleContext}
            />
            <span>{t('tier.menu.context')}</span>
          </label>
          <span
            className={`dsh-pe-tier-default${contextLock !== undefined || !contextIsPinnable ? ' is-locked' : ''}`}
            title={
              // The pin radio has its own vocabulary: "there is nothing to pin
              // here" is a different sentence from the checkbox's reason, and
              // the checkbox already carries the specific one.
              !contextIsPinnable
                ? t('tier.menu.context.lockedHint')
                : contextLock !== undefined
                  ? contextLock
                  : contextIsPinned
                    ? t('tier.menu.context.pinned', { state: t(useContext ? 'tier.menu.context.on' : 'tier.menu.context.off') })
                    : t('tier.menu.context.pin')
            }
          >
            {/* A button with role="radio", not a real radio: a checked radio
                swallows repeat clicks (no change event fires), which would make
                "tick again to unpin" unreachable. The tier rows use the same
                button pattern. */}
            <button
              type="button"
              role="radio"
              aria-checked={contextIsPinned}
              disabled={contextLock !== undefined || !contextIsPinnable}
              aria-label={`${t('tier.menu.context.default')}：${t(useContext ? 'tier.menu.context.on' : 'tier.menu.context.off')}`}
              onClick={() => makeDefaultContext(useContext)}
            />
          </span>
        </div>
        {temporary ? (
          <div className="dsh-pe-tier-foot" role="status">
            {t('tier.menu.session', { tier: t(NAME_KEY[tier]) })}
          </div>
        ) : null}
      </div>
    </details>
  )
}

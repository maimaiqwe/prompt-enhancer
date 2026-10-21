// @vitest-environment jsdom
/**
 * Component tests for the tier capsule and its popover.
 *
 * These lock the behaviours the composer depends on:
 * - the capsule renders the tier in force;
 * - clicking a tier row is a **session-only** pick (no request, no default change);
 * - the radio at a row's right edge is the **default** pick, and 系统 is exempt;
 * - the context row follows the tier preset until it is overridden;
 * - both layers survive a reload through their own storage.
 * @module tests/tier-menu
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { TierMenu } from '../src/client/TierMenu'
import { zh } from '../src/client/locales'
import { DEFAULT_CLIENT_SETTINGS, setClientSettings } from '../src/client/settings'
import {
  clearOverrides,
  defaultContextOf,
  defaultTierOf,
  effectiveTier,
  effectiveUseContext,
  hasSessionPick,
  registerTierPersist,
  selectUseContext,
  setDefaultContext,
  setDefaultTier,
} from '../src/client/tier-store'

const t = ((key: string, params?: Record<string, unknown>): string => {
  let s = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) s = s.split(`{${name}}`).join(String(value))
  return s
}) as TranslateNS<'prompt-enhance'>

const SESSION = 'session-a'

/** The clickable row of one tier (distinct from that row's default radio). */
function tierRow(tier: string): HTMLElement {
  const name = (zh as Record<string, string>)[`tier.${tier}`] ?? tier
  const hint = (zh as Record<string, string>)[`tier.${tier}.hint`] ?? ''
  return screen.getByRole('radio', { name: `${name}：${hint}` })
}

/** The default radio living at the right edge of one tier's row. */
function defaultRadio(tier: string): HTMLInputElement {
  const name = (zh as Record<string, string>)[`tier.${tier}`] ?? tier
  return screen.getByRole('radio', { name: `${zh['tier.menu.default']}：${name}` }) as HTMLInputElement
}

/**
 * The context row's default radio ("pin the current on/off state").
 *
 * Matched by its label prefix rather than the full name: the name ends in the
 * CURRENT on/off state, so an exact match would break the moment the checkbox
 * is toggled — the button is the same control either way.
 */
function contextDefaultRadio(): HTMLButtonElement {
  const prefix = `${zh['tier.menu.context.default']}：`
  const found = screen
    .getAllByRole('radio')
    .find((node) => (node.getAttribute('aria-label') ?? '').startsWith(prefix))
  if (found === undefined) throw new Error(`no context default radio (${prefix}…)`)
  return found as HTMLButtonElement
}

function writer(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {})
}

beforeEach(() => {
  registerTierPersist(undefined)
  // The local defaults outlive a test (module state + localStorage), so reset
  // them explicitly instead of trusting the previous test to leave them alone.
  setDefaultTier('standard')
  setDefaultContext(undefined)
  clearOverrides()
  setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, defaultTier: 'standard' })
})

afterEach(() => {
  cleanup()
  registerTierPersist(undefined)
})

describe('TierMenu', () => {
  it('shows the tier in force as the capsule label', () => {
    render(<TierMenu sessionKey={SESSION} t={t} />)
    expect(screen.getByLabelText(t('tier.current', { tier: t('tier.standard') }))).toBeTruthy()
  })

  it('follows the persisted default until a session override exists', () => {
    setDefaultTier('professional')
    render(<TierMenu sessionKey={SESSION} t={t} />)
    expect(effectiveTier(SESSION)).toBe('professional')
    expect(screen.getByLabelText(t('tier.current', { tier: t('tier.professional') }))).toBeTruthy()
  })

  it('picking a tier changes this session only, not the default', () => {
    render(<TierMenu sessionKey={SESSION} t={t} />)
    fireEvent.click(tierRow('professional'))
    expect(effectiveTier(SESSION)).toBe('professional')
    expect(defaultTierOf()).toBe('standard')
    // Another conversation still starts from the default.
    expect(effectiveTier('session-b')).toBe('standard')
  })

  it('keeps the popover open and reports the temporary pick', () => {
    const { container } = render(<TierMenu sessionKey={SESSION} t={t} />)
    const details = container.querySelector('details') as HTMLDetailsElement
    details.open = true
    fireEvent.click(tierRow('professional'))
    // Both decisions (which tier, whether it becomes the default) are usually
    // made in one visit, so the pick must not dismiss the popover.
    expect(details.open).toBe(true)
    expect(hasSessionPick(SESSION)).toBe(true)
    expect(screen.getByRole('status').textContent).toBe(
      t('tier.menu.session', { tier: t('tier.professional') }),
    )
  })

  it('re-seeds the context toggle from the new tier preset', () => {
    render(<TierMenu sessionKey={SESSION} t={t} />)
    // 标准 admits history.
    expect(effectiveUseContext(SESSION)).toBe(true)
    fireEvent.click(tierRow('base'))
    // 基础 never does: its rules forbid expansion.
    expect(effectiveUseContext(SESSION)).toBe(false)
  })

  it('lets the context row override the preset for this session only', () => {
    render(<TierMenu sessionKey={SESSION} t={t} />)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(effectiveUseContext(SESSION)).toBe(false)
    expect(effectiveUseContext('session-b')).toBe(true)
  })

  it('locks the context row on a tier that cannot use history', () => {
    render(<TierMenu sessionKey={SESSION} t={t} />)
    fireEvent.click(tierRow('base'))
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(box.disabled).toBe(true)
    // Both the checkbox and the pin radio are disabled and carry the lock hint.
    expect(screen.getByTitle(t('tier.menu.context.lockedHint'))).toBeTruthy()
    const pin = screen.getByRole('radio', { name: `${zh['tier.menu.context.default']}：${zh['tier.menu.context.off']}` }) as HTMLButtonElement
    expect(pin.disabled).toBe(true)
    fireEvent.click(pin)
    expect(defaultContextOf()).toBe(undefined)
  })

  it('locks the context row while the plugin-level switch is off', () => {
    // The host treats `contextAware` as a master switch: no tier preset can
    // re-enable history, so the row must not pretend otherwise.
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, contextAware: false })
    render(<TierMenu sessionKey={SESSION} t={t} />)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.disabled).toBe(true)
    expect(box.checked).toBe(false)
    fireEvent.click(tierRow('professional'))
    expect(effectiveUseContext(SESSION)).toBe(false)
  })

  it('ticks the default radio on the persisted default', () => {
    setDefaultTier('professional')
    render(<TierMenu sessionKey={SESSION} t={t} />)
    expect(defaultRadio('professional').checked).toBe(true)
    expect(defaultRadio('standard').checked).toBe(false)
  })

  it('makes a tier the default and applies it here too', () => {
    const write = writer()
    registerTierPersist(write)
    render(<TierMenu sessionKey={SESSION} t={t} />)
    fireEvent.click(defaultRadio('professional'))
    expect(write).toHaveBeenCalledWith('professional')
    expect(defaultTierOf()).toBe('professional')
    expect(effectiveTier(SESSION)).toBe('professional')
    // A session that follows the default needs no pick of its own.
    expect(hasSessionPick('session-b')).toBe(false)
    expect(effectiveTier('session-b')).toBe('professional')
  })

  it('still records the default locally when no settings writer is bound', () => {
    // A profile without the settings service can still keep a default; only the
    // host copy of `defaultTier` stays stale.
    registerTierPersist(undefined)
    render(<TierMenu sessionKey={SESSION} t={t} />)
    fireEvent.click(defaultRadio('base'))
    expect(defaultTierOf()).toBe('base')
  })

  it('refuses to make the system tier the default, like the hotkey layer', () => {
    // 系统 rewrites a whole persona; making it the default would turn every
    // later enhancement into that, so its radio is inert and explained.
    registerTierPersist(writer())
    render(<TierMenu sessionKey={SESSION} t={t} />)
    const radio = defaultRadio('system')
    expect(radio.disabled).toBe(true)
    fireEvent.click(radio)
    expect(defaultTierOf()).toBe('standard')
    expect(screen.getByTitle(t('tier.menu.default.systemBlocked'))).toBeTruthy()
  })

  it('keeps a session choice across a client reload', async () => {
    // A refresh re-executes the bundle; without a stored copy the toggle the
    // user just switched off would come back on and look ignored.
    selectUseContext(SESSION, false)
    expect(window.sessionStorage.getItem('dsh-prompt-enhance:session-picks:v1')).toContain('"context"')
    vi.resetModules()
    const fresh = await import('../src/client/tier-store')
    expect(fresh.effectiveUseContext(SESSION)).toBe(false)
  })

  it('keeps the default across a client reload', async () => {
    setDefaultTier('professional')
    vi.resetModules()
    const fresh = await import('../src/client/tier-store')
    expect(fresh.defaultTierOf()).toBe('professional')
  })

  it('pins the context default from the row radio and applies it here', () => {
    render(<TierMenu sessionKey={SESSION} t={t} />)
    fireEvent.click(contextDefaultRadio())
    expect(defaultContextOf()).toBe(true)
    // Pinning applies the state here too, and a fresh conversation inherits it.
    expect(effectiveUseContext(SESSION)).toBe(true)
    expect(effectiveUseContext('session-b')).toBe(true)
    // The radio now reads pinned. A button, not a real radio: `aria-checked`
    // is the state, and `.checked` does not exist on a button element.
    expect(contextDefaultRadio().getAttribute('aria-checked')).toBe('true')
  })

  it('pins context off and survives a reload', async () => {
    render(<TierMenu sessionKey={SESSION} t={t} />)
    fireEvent.click(tierRow('professional'))
    fireEvent.click(contextDefaultRadio()) // currently on → pins on
    expect(defaultContextOf()).toBe(true)
    // Tick again on the already-pinned state → unpins (button click, always
    // reachable — unlike a real radio, which swallows repeat clicks).
    fireEvent.click(contextDefaultRadio())
    expect(defaultContextOf()).toBe(undefined)
    // Pin off via a session override of the checkbox first.
    fireEvent.click(screen.getByRole('checkbox'))
    expect(effectiveUseContext(SESSION)).toBe(false)
    fireEvent.click(contextDefaultRadio()) // current off → pins off
    expect(defaultContextOf()).toBe(false)
    vi.resetModules()
    const fresh = await import('../src/client/tier-store')
    expect(fresh.defaultContextOf()).toBe(false)
  })

  it('lets the pinned context default outrank the tier presets', () => {
    setDefaultContext(false)
    render(<TierMenu sessionKey={SESSION} t={t} />)
    // 标准's preset would admit history; the pin says otherwise.
    expect(effectiveUseContext(SESSION)).toBe(false)
    // A per-session pick still wins over the pin.
    fireEvent.click(screen.getByRole('checkbox'))
    expect(effectiveUseContext(SESSION)).toBe(true)
    expect(effectiveUseContext('session-b')).toBe(false)
  })
})

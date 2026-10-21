// @vitest-environment jsdom
/**
 * Component tests for the tier capsule and its popover.
 *
 * These lock the three behaviors the composer depends on: the capsule renders
 * the tier in force, picking a tier changes only the selection (no request),
 * and the context row follows the tier preset until it is overridden.
 * @module tests/tier-menu
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { TierMenu } from '../src/client/TierMenu'
import { zh } from '../src/client/locales'
import { DEFAULT_CLIENT_SETTINGS, setClientSettings } from '../src/client/settings'
import { clearOverrides, effectiveTier, effectiveUseContext, registerTierPersist } from '../src/client/tier-store'

const t = ((key: string, params?: Record<string, unknown>): string => {
  let s = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) s = s.split(`{${name}}`).join(String(value))
  return s
}) as TranslateNS<'prompt-enhance'>

const SESSION = 'session-a'

beforeEach(() => {
  clearOverrides()
  setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, defaultTier: 'standard' })
})

afterEach(() => {
  cleanup()
  registerTierPersist(undefined as unknown as (tier: never) => Promise<void>)
})

describe('TierMenu', () => {
  it('shows the tier in force as the capsule label', () => {
    render(<TierMenu sessionKey={SESSION} t={t} />)
    expect(screen.getByLabelText(t('tier.current', { tier: t('tier.standard') }))).toBeTruthy()
  })

  it('follows the persisted default until a session override exists', () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, defaultTier: 'professional' })
    render(<TierMenu sessionKey={SESSION} t={t} />)
    expect(effectiveTier(SESSION)).toBe('professional')
    expect(screen.getByLabelText(t('tier.current', { tier: t('tier.professional') }))).toBeTruthy()
  })

  it('picking a tier updates the selection without touching the default setting', () => {
    const before = DEFAULT_CLIENT_SETTINGS.defaultTier
    render(<TierMenu sessionKey={SESSION} t={t} />)
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(t('tier.system')) }))
    expect(effectiveTier(SESSION)).toBe('system')
    expect(DEFAULT_CLIENT_SETTINGS.defaultTier).toBe(before)
  })

  it('re-seeds the context toggle from the new tier preset', () => {
    render(<TierMenu sessionKey={SESSION} t={t} />)
    // 标准 admits history.
    expect(effectiveUseContext(SESSION)).toBe(true)
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(t('tier.base')) }))
    // 基础 never does: its rules forbid expansion.
    expect(effectiveUseContext(SESSION)).toBe(false)
  })

  it('lets the context row override the preset for this session only', () => {
    render(<TierMenu sessionKey={SESSION} t={t} />)
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(t('tier.base')) }))
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(effectiveUseContext(SESSION)).toBe(true)
    // Another session keeps its own preset.
    expect(effectiveUseContext('session-b')).toBe(true)
  })

  it('persists the tier through the registered writer', async () => {
    const writer = vi.fn(async () => {})
    registerTierPersist(writer)
    render(<TierMenu sessionKey={SESSION} t={t} />)
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(t('tier.professional')) }))
    fireEvent.click(screen.getByText(t('tier.menu.default')))
    expect(writer).toHaveBeenCalledWith('professional')
  })

  it('closes the popover after a pick', () => {
    const { container } = render(<TierMenu sessionKey={SESSION} t={t} />)
    const details = container.querySelector('details') as HTMLDetailsElement
    details.open = true
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(t('tier.professional')) }))
    expect(details.open).toBe(false)
  })
})

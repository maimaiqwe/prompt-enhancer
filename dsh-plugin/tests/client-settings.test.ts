import { describe, expect, it } from 'vitest'
import { decodeClientSettings, DEFAULT_CLIENT_SETTINGS } from '../src/client/settings'

describe('decodeClientSettings', () => {
  it('returns defaults for a missing or malformed section', () => {
    expect(decodeClientSettings(undefined)).toEqual(DEFAULT_CLIENT_SETTINGS)
    expect(decodeClientSettings(null)).toEqual(DEFAULT_CLIENT_SETTINGS)
    expect(decodeClientSettings('nope')).toEqual(DEFAULT_CLIENT_SETTINGS)
  })

  it('reads well-formed fields', () => {
    expect(
      decodeClientSettings({ enabled: false, maxInputChars: 8000, shortcut: 'ctrl+shift+e', streaming: false }),
    ).toEqual({
      enabled: false,
      maxInputChars: 8000,
      shortcut: 'ctrl+shift+e',
      streaming: false,
      contextAware: true,
      defaultTier: 'standard',
    })
  })

  it('falls back field-by-field on bad values', () => {
    expect(decodeClientSettings({ enabled: 'yes', maxInputChars: -5, shortcut: 7, streaming: 'no' })).toEqual(DEFAULT_CLIENT_SETTINGS)
    expect(decodeClientSettings({ maxInputChars: 4096.9 }).maxInputChars).toBe(4096)
  })

  it('keeps streaming on by default and off only when explicitly false', () => {
    expect(decodeClientSettings({}).streaming).toBe(true)
    expect(decodeClientSettings({ streaming: false }).streaming).toBe(false)
  })
})

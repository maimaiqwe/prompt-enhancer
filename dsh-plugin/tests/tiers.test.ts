/**
 * The four tiers: token narrowing, prompt composition from the shared rules
 * file, and the per-tier context window that the composer toggle and the host
 * both read. The composition assertions double as the regression fence for
 * `scripts/generate-tiers.mjs`: if `core/rules.md` is edited without
 * regenerating, the generated module goes stale and the build fails before
 * these run — but if the generator ever drops or reorders a section, the
 * anchors below catch it here.
 * @module tests/tiers
 */

import { describe, expect, it } from 'vitest'
import {
  contextWindowFor,
  DEFAULT_TIER,
  normalizeTier,
  TIERS,
  tierSystemPrompt,
  TIER_CONTEXT_PRESET,
} from '../src/tiers'
import { RULE_SECTIONS } from '../src/generated/tier-rules'

const CONFIG = { contextAware: true, contextMaxMessages: 8, contextMaxChars: 4000 }

describe('normalizeTier', () => {
  it('accepts every shipped tier, case and whitespace tolerant', () => {
    for (const tier of TIERS) {
      expect(normalizeTier(tier)).toBe(tier)
      expect(normalizeTier(` ${tier.toUpperCase()} `)).toBe(tier)
    }
  })

  it('falls back instead of throwing on anything else', () => {
    expect(normalizeTier(undefined)).toBe(DEFAULT_TIER)
    expect(normalizeTier('')).toBe(DEFAULT_TIER)
    expect(normalizeTier('turbo')).toBe(DEFAULT_TIER)
    expect(normalizeTier(7)).toBe(DEFAULT_TIER)
    expect(normalizeTier(null, 'base')).toBe('base')
  })

  it('defaults to the documented standard tier', () => {
    expect(DEFAULT_TIER).toBe('standard')
  })
})

describe('tierSystemPrompt', () => {
  it('composes [COMMON] plus exactly one tier section', () => {
    const base = tierSystemPrompt('base')
    const standard = tierSystemPrompt('standard')
    const professional = tierSystemPrompt('professional')
    const system = tierSystemPrompt('system')
    for (const prompt of [base, standard, professional, system]) {
      expect(prompt.startsWith(RULE_SECTIONS.COMMON)).toBe(true)
    }
    // Each tier carries its own section and none of the others.
    expect(base).toContain(RULE_SECTIONS.BASE)
    expect(base).not.toContain(RULE_SECTIONS.STANDARD)
    expect(standard).toContain(RULE_SECTIONS.STANDARD)
    expect(standard).not.toContain(RULE_SECTIONS.PROFESSIONAL)
    expect(professional).toContain(RULE_SECTIONS.PROFESSIONAL)
    expect(professional).not.toContain(RULE_SECTIONS.SYSTEM)
    expect(system).toContain(RULE_SECTIONS.SYSTEM)
    expect(system).not.toContain(RULE_SECTIONS.PROFESSIONAL)
  })

  it('keeps the four tiers distinct', () => {
    const prompts = TIERS.map((tier) => tierSystemPrompt(tier))
    expect(new Set(prompts).size).toBe(TIERS.length)
  })

  it('states the <raw_prompt> framing, which the framing helper relies on', () => {
    for (const tier of TIERS) {
      expect(tierSystemPrompt(tier)).toContain('<raw_prompt>')
    }
  })

  it('memoizes per tier', () => {
    expect(tierSystemPrompt('standard')).toBe(tierSystemPrompt('standard'))
  })

  it('keeps the shared fidelity floor in every tier', () => {
    // The [COMMON] section is the part the Windows hotkey layer and this
    // plugin must never diverge on: placeholders, fidelity, output discipline.
    for (const tier of TIERS) {
      const prompt = tierSystemPrompt(tier)
      expect(prompt).toContain('__PO_SKILL_0001__')
      expect(prompt).toContain('输出纪律')
    }
  })
})

describe('contextWindowFor', () => {
  it('lets the per-call toggle narrow the window but never override the master switch', () => {
    // The composer always sends its own toggle, so the config value has to act
    // as a master switch: a tier preset must not resurrect history after the
    // operator switched 上下文感知 off.
    expect(contextWindowFor('standard', { ...CONFIG, contextAware: false }, true)).toBeUndefined()
    expect(contextWindowFor('standard', CONFIG, false)).toBeUndefined()
  })

  it('follows the config switch when no per-call value is given', () => {
    expect(contextWindowFor('standard', { ...CONFIG, contextAware: false })).toBeUndefined()
    expect(contextWindowFor('standard', CONFIG)).toEqual({ maxMessages: 4, maxChars: 3000 })
  })

  it('never grants context to the base tier', () => {
    expect(TIER_CONTEXT_PRESET.base.useContext).toBe(false)
    expect(contextWindowFor('base', CONFIG)).toBeUndefined()
    expect(contextWindowFor('base', CONFIG, true)).toBeUndefined()
  })

  it('narrows to the smaller of the preset and the configured caps', () => {
    expect(contextWindowFor('professional', { contextAware: true, contextMaxMessages: 2, contextMaxChars: 1000 }))
      .toEqual({ maxMessages: 2, maxChars: 1000 })
    expect(contextWindowFor('standard', { contextAware: true, contextMaxMessages: 50, contextMaxChars: 100000 }))
      .toEqual({ maxMessages: 4, maxChars: 3000 })
  })

  it('yields nothing when either cap is 0', () => {
    expect(contextWindowFor('standard', { contextAware: true, contextMaxMessages: 0, contextMaxChars: 4000 })).toBeUndefined()
    expect(contextWindowFor('standard', { contextAware: true, contextMaxMessages: 8, contextMaxChars: 0 })).toBeUndefined()
  })
})

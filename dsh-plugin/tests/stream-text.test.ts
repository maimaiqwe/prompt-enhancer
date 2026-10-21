/**
 * Incremental display normalization: what the panel may show while the text
 * is still arriving. The final body always comes from `normalizeOutput` over
 * the complete output, so these tests only lock the display-time behaviour:
 * a leading fence is never shown, and a possible fence closer is withheld
 * until more text (or the end of the stream) resolves it.
 * @module tests/stream-text
 */

import { describe, expect, it } from 'vitest'
import { createStreamNormalizer } from '../src/shared/stream-text'

/** Feed every chunk and concatenate what the normalizer releases. */
function feed(chunks: string[]): { shown: string; tail: string } {
  const normalizer = createStreamNormalizer()
  const shown = chunks.map((chunk) => normalizer.push(chunk)).join('')
  return { shown, tail: normalizer.finish() }
}

describe('createStreamNormalizer', () => {
  it('passes plain text straight through', () => {
    const { shown, tail } = feed(['角色：', '翻译。'])
    expect(shown).toBe('角色：翻译。')
    expect(tail).toBe('')
  })

  it('hides a leading fence', () => {
    const { shown, tail } = feed(['```\n', '角色：翻译', '\n```'])
    expect(shown).toBe('角色：翻译')
    expect(tail).toBe('')
  })

  it('hides a leading fence that carries a language', () => {
    const { shown, tail } = feed(['```markdown', '\nbody', '\n```'])
    expect(shown).toBe('body')
    expect(tail).toBe('')
  })

  it('withholds a bare fence prefix until it resolves', () => {
    const normalizer = createStreamNormalizer()
    expect(normalizer.push('`')).toBe('')
    expect(normalizer.push('`')).toBe('')
    expect(normalizer.push('`')).toBe('')
    expect(normalizer.push('\nbody')).toBe('body')
    expect(normalizer.finish()).toBe('')
  })

  it('releases a fence prefix that turns out to be content', () => {
    const normalizer = createStreamNormalizer()
    expect(normalizer.push('``')).toBe('')
    expect(normalizer.push(' inline ` and more')).toBe('`` inline ` and more')
    // The trailing single backtick was withheld as a possible closer…
    expect(normalizer.finish()).toBe('')
  })

  it('withholds a trailing backtick that might be a fence closer', () => {
    const normalizer = createStreamNormalizer()
    expect(normalizer.push('use `code`')).toBe('use `code')
    // No closing fence ever arrived, so the withheld backtick comes back.
    expect(normalizer.finish()).toBe('`')
  })

  it('handles a chunked fence that straddles chunk boundaries', () => {
    const { shown, tail } = feed(['```\n', 'a', '`', '`', '`'])
    expect(shown).toBe('a')
    expect(tail).toBe('')
  })

  it('releases withheld text at the end of a fence-free stream', () => {
    const normalizer = createStreamNormalizer()
    expect(normalizer.push('结尾带一个 `')).toBe('结尾带一个 ')
    expect(normalizer.finish()).toBe('`')
  })

  it('is unaffected by an empty stream', () => {
    const { shown, tail } = feed([])
    expect(shown).toBe('')
    expect(tail).toBe('')
  })
})

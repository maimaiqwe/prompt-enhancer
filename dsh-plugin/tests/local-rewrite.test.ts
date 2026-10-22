/**
 * The deterministic base pass: the one tier that must not reach a model.
 *
 * These tests pin the two promises that make 基础 worth its own code path —
 * it never invents content, and it never damages what it cannot understand
 * (Skill tokens, code, structure). They also pin idempotence, because pressing
 * ✨ twice on a tidied draft is a normal thing to do.
 * @module tests/local-rewrite
 */

import { describe, expect, it } from 'vitest'
import { protectSkillTokens, restoreSkillTokens, rewriteLocally } from '../src/local-rewrite'
import { onlySkillTokens } from '../src/shared/skill-tokens'

describe('rewriteLocally', () => {
  it('squeezes inner whitespace and trims the edges', () => {
    expect(rewriteLocally('  帮我   看看这个    报错  ')).toBe('请帮我 看看这个 报错。')
  })

  it('keeps list, heading, table and quote lines structurally intact', () => {
    const input = ['#  标题', '-   第一项', '|  a  |  b  |', '>   引用'].join('\n')
    expect(rewriteLocally(input)).toBe(['#  标题', '-   第一项', '|  a  |  b  |', '>   引用'].join('\n'))
  })

  it('adds terminal punctuation to the last natural-language line only', () => {
    expect(rewriteLocally('第一行没有句号\n- 列表项不动\n最后一行')).toBe('第一行没有句号\n- 列表项不动\n最后一行。')
  })

  it('does not append a second mark when the line already ends properly', () => {
    expect(rewriteLocally('已经写好了？')).toBe('已经写好了？')
  })

  it('normalises the two verbal tics without touching anything else', () => {
    expect(rewriteLocally('这个咋弄，那个是啥')).toBe('这个怎么弄，那个是什么。')
  })

  it('leaves a fenced code block byte-identical', () => {
    const block = '```js\nconst  a   =  1\n```'
    expect(rewriteLocally(`看这段\n${block}\n对不对`)).toBe(`看这段\n${block}\n对不对。`)
  })

  it('leaves an inline code span byte-identical', () => {
    expect(rewriteLocally('调用 `a   b`  一下')).toBe('调用 `a   b` 一下。')
  })

  it('keeps a Skill token verbatim and tidies around it', () => {
    // The leading-ask rewrite is anchored to the start of the text (the same
    // rule the Windows hotkey layer uses), so a token in front keeps 帮我 as is.
    expect(rewriteLocally('  $p    帮我看看  ')).toBe('$p 帮我看看。')
  })

  it('keeps several Skill tokens in their original order', () => {
    expect(rewriteLocally('$p 用 $prompt-enhancer 试试')).toBe('$p 用 $prompt-enhancer 试试。')
  })

  it('is idempotent', () => {
    const once = rewriteLocally('  帮我  看看 $p   `code`   ')
    expect(rewriteLocally(once)).toBe(once)
  })

  it('does not eat a dollar amount that is not a Skill token', () => {
    expect(rewriteLocally('花了 $100 买书')).toBe('花了 $100 买书。')
  })
})

describe('protectSkillTokens / restoreSkillTokens', () => {
  it('round-trips every token and records them in order', () => {
    const { text, tokens } = protectSkillTokens('$p 和 $prompt-enhancer')
    expect(tokens).toEqual(['$p', '$prompt-enhancer'])
    expect(text).not.toContain('$p ')
    expect(restoreSkillTokens(text, tokens)).toBe('$p 和 $prompt-enhancer')
  })

  it('ignores a `$` glued to a preceding word character', () => {
    const { tokens } = protectSkillTokens('US$100')
    expect(tokens).toEqual([])
  })
})

describe('onlySkillTokens', () => {
  it('is true for a draft of tokens and whitespace', () => {
    expect(onlySkillTokens('$p')).toBe(true)
    expect(onlySkillTokens('  $p  $prompt-enhancer \n')).toBe(true)
  })

  it('is false as soon as a real request rides along', () => {
    expect(onlySkillTokens('$p 帮我改')).toBe(false)
    expect(onlySkillTokens('帮我改')).toBe(false)
  })

  it('is false for an empty draft, which owns a different refusal', () => {
    expect(onlySkillTokens('')).toBe(false)
    expect(onlySkillTokens('   \n ')).toBe(false)
  })
})

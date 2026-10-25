/**
 * @module tests/literal-guard
 */
import { describe, expect, it } from 'vitest'
import { protectDraft, restoreResult } from '../src/shared/literal-guard'

const WIN_LINK = '[$grill-me](C:\\Users\\Mai\\.agents\\skills\\grill-me\\SKILL.md)'

describe('protectDraft', () => {
  it('strips a linked skill reference wholesale', () => {
    const { guarded, guard } = protectDraft(`复验并优化 ${WIN_LINK} 然后列清单`)
    expect(guarded).not.to.contain('C:')
    expect(guarded).not.to.contain('$grill-me')
    expect(guarded).to.contain('__PO_LIT_0001__')
    expect(guard.litItems).toHaveLength(1)
  })

  it('strips bare paths and urls but keeps prose', () => {
    const { guarded, guard } = protectDraft('改 E:/a/b/c.md 和 https://example.com/x 的说明')
    expect(guarded).not.to.contain('example.com')
    expect(guarded).not.to.contain('E:/a/b/c.md')
    expect(guarded).to.contain('改')
    expect(guard.litItems).toHaveLength(2)
  })

  it('anchors bare skill tokens separately', () => {
    const { guarded, guard } = protectDraft('用 $grill-me 拷问我')
    expect(guarded).not.to.contain('$grill-me')
    expect(guard.skillTokens).toEqual(['$grill-me'])
  })

  it('strips bare filenames and emails', () => {
    const { guarded, guard } = protectDraft('先读 rules.md 再联系 a.b@example.com')
    expect(guarded).not.to.contain('rules.md')
    expect(guarded).not.to.contain('example.com')
    expect(guarded).to.contain('先读')
    expect(guard.litItems).toHaveLength(2)
    const out = restoreResult('请先读__PO_LIT_0001__，再联系__PO_LIT_0002__。', guard)
    expect(out).to.contain('rules.md')
    expect(out).to.contain('a.b@example.com')
  })

  it('does not swallow CJK prose after a path or url', () => {
    const text = '看 E:/a/b/c.md，然后改 rules.md。参考 https://x.io/a，最后收尾'
    const { guarded, guard } = protectDraft(text)
    expect(guarded).to.contain('，然后改')
    expect(guarded).to.contain('，最后收尾')
    expect(restoreResult(guarded, guard)).toBe(text)
  })

  it('round-trips untouched prose', () => {
    const text = '帮我把这个文章继续优化。'
    const { guarded, guard } = protectDraft(text)
    expect(guarded).toBe(text)
    expect(restoreResult('请帮我把这个文章继续优化。', guard)).toBe('请帮我把这个文章继续优化。')
  })
})

describe('restoreResult', () => {
  it('restores everything the model kept in place', () => {
    const { guarded, guard } = protectDraft(`复验并优化 ${WIN_LINK} 然后列清单`)
    const out = restoreResult(`请复验并优化：__PO_LIT_0001__，然后列出完整清单。`, guard)
    expect(out).to.contain(WIN_LINK)
  })

  it('appends dropped literals instead of failing', () => {
    const { guard } = protectDraft(`复验 ${WIN_LINK} 并优化 $p 其他`)
    const out = restoreResult('请复验并优化相关内容，并列出完整清单。', guard)
    expect(out).to.contain(WIN_LINK)
    expect(out).to.contain('$p')
  })

  it('strips hallucinated anchors', () => {
    const { guard } = protectDraft('做三个按钮')
    expect(restoreResult('做__PO_LIT_9999__三个按钮', guard)).toBe('做三个按钮')
  })
})

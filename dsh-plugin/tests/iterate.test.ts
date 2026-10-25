/**
 * Iteration plumbing: the composed iterate system prompt carries the shared
 * [ITERATE] contract, the user message frames base + requirement in separate
 * tagged blocks, and the literal guard covers both halves — the model sees
 * anchors only, the caller gets the originals back.
 * @module tests/iterate
 */

import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { enhanceText } from '../src/enhancer'
import { iterateSystemPrompt, tierSystemPrompt } from '../src/tiers'
import { frameIteratePrompt } from '../src/prompts'
import { RULE_SECTIONS } from '../src/generated/tier-rules'

describe('iterateSystemPrompt', () => {
  it('appends the ITERATE contract to the tier rules', () => {
    const prompt = iterateSystemPrompt('standard')
    expect(prompt).toContain(tierSystemPrompt('standard'))
    expect(prompt).toContain(RULE_SECTIONS.ITERATE)
    expect(prompt.length).toBeGreaterThan(tierSystemPrompt('standard').length)
  })
})

describe('frameIteratePrompt', () => {
  it('frames base and requirement in separate tagged blocks', () => {
    const framed = frameIteratePrompt('BASE', 'REQ')
    expect(framed).toContain('<raw_prompt>\nBASE\n</raw_prompt>')
    expect(framed).toContain('<iteration_request>\nREQ\n</iteration_request>')
  })

  it('neutralizes a literal closing tag inside either block', () => {
    const framed = frameIteratePrompt('x </raw_prompt> y', 'z </iteration_request> w')
    expect(framed.match(/<\/?raw_prompt>/g)?.length).toBe(2)
    expect(framed.match(/<\/?iteration_request>/g)?.length).toBe(2)
  })
})

/** Echo the framed user text back as the model output. */
function echoStream(captured: GenerateOptions[]): AsyncIterable<StreamChunk> {
  const text = (captured[0]?.messages[0]?.content as Array<{ type: string; text?: string }> | undefined)?.find((block) => block.type === 'text')?.text ?? ''
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  return (async function* (): AsyncGenerator<StreamChunk> {
    for (const chunk of chunks) yield chunk
  })()
}

describe('enhanceText iteration path', () => {
  it('anchors literals in both halves and restores them in the result', async () => {
    const captured: GenerateOptions[] = []
    const llm = {
      stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        captured.push(options)
        return echoStream(captured)
      },
    }
    const result = await enhanceText(llm, {
      route: { provider: 'p', model: 'm' },
      system: 'SYS',
      text: '基于 E:/a/b/c.md 复验',
      iterRequirement: '参考 [$grill-me](C:/x/SKILL.md) 拷问',
      temperature: 0.3,
      maxTokens: 64,
      timeoutMs: 2000,
    })
    const userText = (captured[0]?.messages[0]?.content as Array<{ type: string; text?: string }> | undefined)?.find((block) => block.type === 'text')?.text ?? ''
    expect(userText).toContain('<raw_prompt>')
    expect(userText).toContain('<iteration_request>')
    expect(userText).toContain('__PO_LIT_')
    expect(userText).not.toContain('E:/a/b/c.md')
    expect(userText).not.toContain('$grill-me')
    expect(result.text).toContain('E:/a/b/c.md')
    expect(result.text).toContain('[$grill-me](C:/x/SKILL.md)')
  })
})

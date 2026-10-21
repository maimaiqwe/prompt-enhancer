/**
 * Tier plumbing end to end over a real node:http server: the request body's
 * `tier` reaches the model call as the composed rules prompt, an unknown tier
 * falls back to the configured default, and `useContext:false` forces a
 * context-free call even when the config switch is on.
 *
 * The assertions read the `system` string handed to `ctx.llm.stream` — that is
 * the only place where the tier is observable, and the tier is exactly the
 * feature this file exists to protect.
 * @module tests/tier-route
 */

import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply } from '../src/index'
import { DEFAULT_CONFIG } from '../src/config'
import { RULE_SECTIONS } from '../src/generated/tier-rules'

/** A passing config with the pairing invariants satisfied. */
const CONFIG = { ...DEFAULT_CONFIG }

/** Registered route captured from the stub webServer. */
interface CapturedRoute {
  kind: string
  path: string
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>
}

/** One text stream, then a clean stop. */
function streamOf(text: string): AsyncIterable<StreamChunk> {
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

/**
 * Mount the plugin against a stub context and expose the enhance route over
 * real HTTP, collecting every `GenerateOptions` the route hands to the model.
 * @param config - the config the plugin resolves per request.
 * @param history - derived history the stub session reports (empty by default).
 * @returns the listening server plus the captured calls.
 */
async function mount(
  config = CONFIG,
  history: readonly unknown[] = [],
): Promise<{ server: Server; calls: GenerateOptions[]; close: () => Promise<void> }> {
  const calls: GenerateOptions[] = []
  const captured: CapturedRoute[] = []
  const ctx = {
    get(key: string): unknown {
      if (key === 'llm') {
        return {
          stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
            calls.push(options)
            return streamOf('改写结果')
          },
        }
      }
      if (key === 'webServer') {
        return { register(route: CapturedRoute): () => void { captured.push(route); return () => {} } }
      }
      if (key === 'sessions') {
        return { get: () => ({ deriveMessages: () => history }) }
      }
      if (key === 'settings') return { get: () => ({ provider: 'zhipu', model: 'glm-5.3' }) }
      return undefined
    },
    inject(): void {},
    emit(): void {},
    on(): () => void {
      return () => {}
    },
  }
  apply(ctx as never, config)
  const route = captured[0]
  if (route === undefined) throw new Error('route was not registered')
  const server = createServer((req, res) => {
    void route.handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    server,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** POST one request to the mounted route. */
async function call(server: Server, body: unknown): Promise<{ status: number; json: unknown }> {
  const { port } = server.address() as AddressInfo
  const response = await fetch(`http://127.0.0.1:${port}/prompt-enhance/enhance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, json: (await response.json()) as unknown }
}

/** One derived history message with a single text block. */
function turn(role: 'user' | 'assistant', text: string): unknown {
  return { role, content: [{ type: 'text', text }] }
}

/**
 * Flatten the single user message a call carries. The conversation context
 * rides in the user message (not the system prompt), so context assertions
 * have to read this side.
 * @param call - the captured `GenerateOptions` of one enhance call.
 * @returns every text block of the message, joined.
 */
function userMessageText(call: GenerateOptions | undefined): string {
  const messages = (call?.messages ?? []) as readonly { content?: readonly { type?: string; text?: string }[] }[]
  return messages
    .flatMap(message => message.content ?? [])
    .map(block => (block.type === 'text' ? block.text ?? '' : ''))
    .join('\n')
}

describe('request body tier → composed system prompt', () => {
  it('defaults to the configured tier when the body omits it', async () => {
    const { server, calls, close } = await mount()
    try {
      const { status } = await call(server, { text: '写个爬虫' })
      expect(status).toBe(200)
      expect(calls[0]?.system).toContain(RULE_SECTIONS.STANDARD)
      expect(calls[0]?.system).not.toContain(RULE_SECTIONS.PROFESSIONAL)
    } finally {
      await close()
    }
  })

  it('honours an explicit tier per call', async () => {
    const { server, calls, close } = await mount()
    try {
      await call(server, { text: '写个爬虫', tier: 'professional' })
      expect(calls[0]?.system).toContain(RULE_SECTIONS.PROFESSIONAL)
      expect(calls[0]?.system).not.toContain(RULE_SECTIONS.STANDARD)

      await call(server, { text: '写个爬虫', tier: 'system' })
      expect(calls[1]?.system).toContain(RULE_SECTIONS.SYSTEM)
      expect(calls[1]?.system).not.toContain(RULE_SECTIONS.PROFESSIONAL)
    } finally {
      await close()
    }
  })

  it('follows the configured defaultTier when the body names no tier', async () => {
    const { server, calls, close } = await mount({ ...CONFIG, defaultTier: 'professional' })
    try {
      await call(server, { text: '写个爬虫' })
      expect(calls[0]?.system).toContain(RULE_SECTIONS.PROFESSIONAL)
      expect(calls[0]?.system).not.toContain(RULE_SECTIONS.STANDARD)
    } finally {
      await close()
    }
  })

  it('serves an unknown tier with the configured default instead of rejecting', async () => {
    const { server, calls, close } = await mount({ ...CONFIG, defaultTier: 'professional' })
    try {
      const { status } = await call(server, { text: '写个爬虫', tier: 'turbo' })
      expect(status).toBe(200)
      expect(calls[0]?.system).toContain(RULE_SECTIONS.PROFESSIONAL)
    } finally {
      await close()
    }
  })

  it('tolerates a non-boolean useContext without rejecting the call', async () => {
    const { server, close } = await mount()
    try {
      const { status } = await call(server, { text: '写个爬虫', useContext: 'nope' })
      expect(status).toBe(200)
    } finally {
      await close()
    }
  })
})

describe('per-call context toggle', () => {
  const HISTORY = [turn('user', '我在写一个 Spring Boot 项目'), turn('assistant', '好的')]

  it('grounds the call in history when context is allowed', async () => {
    const { server, calls, close } = await mount(CONFIG, HISTORY)
    try {
      await call(server, { text: '继续', sessionId: 's1', tier: 'professional', useContext: true })
      expect(userMessageText(calls[0])).toContain('<conversation_context>')
      expect(calls[0]?.system).toContain('Hard limits on context use')
    } finally {
      await close()
    }
  })

  it('skips history when the call turns it off, even with contextAware on', async () => {
    const { server, calls, close } = await mount(CONFIG, HISTORY)
    try {
      await call(server, { text: '继续', sessionId: 's1', tier: 'professional', useContext: false })
      expect(userMessageText(calls[0])).not.toContain('<conversation_context>')
      expect(calls[0]?.system).not.toContain('Hard limits on context use')
    } finally {
      await close()
    }
  })

  it('never grounds the base tier, which never reaches a model at all', async () => {
    const { server, calls, close } = await mount(CONFIG, HISTORY)
    try {
      await call(server, { text: '继续', sessionId: 's1', tier: 'base', useContext: true })
      expect(calls).toHaveLength(0)
    } finally {
      await close()
    }
  })

  it('narrows the window to the configured cap', async () => {
    // The professional preset admits 12 messages; the configured cap of 2 wins.
    const long = [turn('user', '最旧的一条不该出现'), turn('assistant', '中间一条'), turn('user', '最新的近邻消息')]
    const { server, calls, close } = await mount({ ...CONFIG, contextMaxMessages: 2, contextMaxChars: 4000 }, long)
    try {
      await call(server, { text: '继续', sessionId: 's1', tier: 'professional', useContext: true })
      const userText = userMessageText(calls[0])
      expect(userText).toContain('<conversation_context>')
      expect(userText).toContain('最新的近邻消息')
      expect(userText).not.toContain('最旧的一条不该出现')
    } finally {
      await close()
    }
  })
})

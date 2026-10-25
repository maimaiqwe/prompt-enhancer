// @vitest-environment jsdom
/**
 * Iteration panel behaviour: base precedence (composer draft → last enhanced →
 * fresh), request payloads for the iterate vs plain-enhancement vs positive
 * paths, replace applies the hand-edited output, and persisted panel state
 * resets on a changed draft.
 * @module tests/iteration-panel
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IterationPanel } from '../src/client/IterationPanel'
import { zh } from '../src/client/locales'
import { clearIterPanel, loadIterPanel, recordLastEnhanced, saveIterPanel } from '../src/client/iter-state'

const t = ((key: string, params?: Record<string, unknown>): string => {
  let s = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) s = s.split(`{${name}}`).join(String(value))
  return s
}) as TranslateNS<'prompt-enhance'>

const ENVELOPE = { ok: true, value: { text: 'ITER_OUT', provider: 'p', model: 'm', elapsedMs: 1 } }

function lastBody(): Record<string, unknown> {
  const call = vi.mocked(globalThis.fetch).mock.calls.at(-1)
  const init = call?.[1] as { body?: Uint8Array } | undefined
  return JSON.parse(new TextDecoder().decode(init?.body ?? new Uint8Array())) as Record<string, unknown>
}

function inputPane(): HTMLTextAreaElement {
  return screen.getByLabelText(zh['iter.panel.input.label']) as HTMLTextAreaElement
}

function outputPane(): HTMLTextAreaElement {
  return screen.getByLabelText(zh['iter.panel.output.label']) as HTMLTextAreaElement
}

function mount(props: Partial<Parameters<typeof IterationPanel>[0]> & { draft?: string; uiKey?: string } = {}): {
  setDraft: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
} {
  const setDraft = vi.fn()
  const onClose = vi.fn()
  render(
    <IterationPanel
      t={t}
      uiKey={props.uiKey ?? 's1'}
      wireId={undefined}
      inputActions={{ setDraft }}
      draft={props.draft ?? ''}
      onClose={onClose}
    />,
  )
  return { setDraft, onClose }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ENVELOPE), { status: 200, headers: { 'content-type': 'application/json' } })))
  globalThis.sessionStorage?.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('IterationPanel', () => {
  it('sends the composer draft as base even when a stale last result exists', async () => {
    recordLastEnhanced('s1', 'STALE_ECOMMERCE_TEXT')
    const { onClose } = mount({ draft: 'DRAFT', uiKey: 's1' })
    // The base line shows the draft (with an excerpt), not the stale result.
    expect(screen.getByText(/基准：当前输入框内容/).textContent).toContain('DRAFT')
    fireEvent.change(inputPane(), { target: { value: '把方向改为复验并优化' } })
    fireEvent.click(screen.getByRole('button', { name: zh['iter.panel.run'] }))
    await waitFor(() => { expect(lastBody()).toBeTruthy() })
    expect(lastBody().text).toBe('DRAFT')
    expect(lastBody().iterRequirement).toBe('把方向改为复验并优化')
    await waitFor(() => { expect(outputPane().value).toBe('ITER_OUT') })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('falls back to the last enhanced result when the box is empty', async () => {
    recordLastEnhanced('s6', 'BASE_TEXT')
    mount({ draft: '', uiKey: 's6' })
    fireEvent.change(inputPane(), { target: { value: '要求 X' } })
    fireEvent.click(screen.getByRole('button', { name: zh['iter.panel.run'] }))
    await waitFor(() => { expect(lastBody()).toBeTruthy() })
    expect(lastBody().text).toBe('BASE_TEXT')
    expect(lastBody().iterRequirement).toBe('要求 X')
  })

  it('falls back to the composer draft when no last result exists', async () => {
    const {} = mount({ draft: 'COMPOSER_DRAFT', uiKey: 's2' })
    fireEvent.change(inputPane(), { target: { value: '要求 X' } })
    fireEvent.click(screen.getByRole('button', { name: zh['iter.panel.run'] }))
    await waitFor(() => { expect(lastBody()).toBeTruthy() })
    expect(lastBody().text).toBe('COMPOSER_DRAFT')
    expect(lastBody().iterRequirement).toBe('要求 X')
  })

  it('sends no iterRequirement when the requirement pane is left empty (plain enhancement of the base)', async () => {
    recordLastEnhanced('s7', 'STALE_TEXT')
    mount({ draft: 'DRAFT', uiKey: 's7' })
    fireEvent.click(screen.getByRole('button', { name: zh['iter.panel.run'] }))
    await waitFor(() => { expect(lastBody()).toBeTruthy() })
    expect(lastBody().text).toBe('DRAFT')
    expect(lastBody().iterRequirement).toBeUndefined()
  })

  it('degrades to a plain enhancement when base and draft are both empty', async () => {
    mount({ draft: '', uiKey: 's3' })
    fireEvent.change(inputPane(), { target: { value: '全新的草稿内容' } })
    fireEvent.click(screen.getByRole('button', { name: zh['iter.panel.run'] }))
    await waitFor(() => { expect(lastBody()).toBeTruthy() })
    expect(lastBody().text).toBe('全新的草稿内容')
    expect(lastBody().iterRequirement).toBeUndefined()
  })

  it('replace applies the hand-edited output and closes', async () => {
    recordLastEnhanced('s4', 'BASE')
    const { setDraft, onClose } = mount({ draft: 'D', uiKey: 's4' })
    fireEvent.change(inputPane(), { target: { value: 'r' } })
    fireEvent.click(screen.getByRole('button', { name: zh['iter.panel.run'] }))
    await waitFor(() => { expect(outputPane().value).toBe('ITER_OUT') })
    fireEvent.change(outputPane(), { target: { value: 'ITER_OUT 手工修改' } })
    fireEvent.click(screen.getByRole('button', { name: zh['iter.panel.replace'] }))
    expect(setDraft).toHaveBeenCalledWith('ITER_OUT 手工修改')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('refuses to run with an empty input pane', () => {
    mount({ draft: '', uiKey: 's5' })
    fireEvent.click(screen.getByRole('button', { name: zh['iter.panel.run'] }))
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(zh['iter.error.empty'])
  })
})

describe('iter-state persistence', () => {
  it('restores panel contents only against an unchanged draft', () => {
    saveIterPanel('k1', { input: 'i', output: 'o', draft: 'SAME' })
    expect(loadIterPanel('k1', 'SAME')).toEqual({ input: 'i', output: 'o' })
    expect(loadIterPanel('k1', 'CHANGED')).toBeUndefined()
    clearIterPanel('k1')
    expect(loadIterPanel('k1', 'SAME')).toBeUndefined()
  })
})

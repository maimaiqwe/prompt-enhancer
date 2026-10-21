// @vitest-environment jsdom
/**
 * Component-level regression tests for the composer enhance flow: the guard
 * chain, the loading → result → apply → undo loop (including the apply/
 * pushUndo/setDraft/UndoBar ordering that must survive React batching),
 * stale marking both ways, and busy-state behavior. The host route is
 * mocked; the ui-state module is the real one.
 * @module tests/client-components
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { EnhanceButton } from '../src/client/EnhanceButton'
import { UndoBar } from '../src/client/UndoBar'
import { requestEnhance, requestEnhanceStream } from '../src/client/enhance-client'
import { zh } from '../src/client/locales'
import * as ui from '../src/client/ui-state'
import { DEFAULT_CLIENT_SETTINGS, setClientSettings } from '../src/client/settings'

/**
 * The slice of the conversation input machine this suite drives.
 *
 * Written out rather than imported: `InputState` lives in
 * `dsh-client-ui-conversation/lib/types/client/input/contract.ts` and is
 * deliberately NOT re-exported from the package root or its `./client` entry
 * (its own doc calls that three-tier visibility intentional), so importing it
 * from the package name is a type error — and it cannot be recovered from the
 * slot prop either, because `SnapshotSelectorHook<T>` is itself generic in the
 * selector's result, which erases the state type. Literal types are the honest
 * stand-in; the props below are built as `never` and the double is exercised
 * against the real `EnhanceButton`, so a contract drift still surfaces.
 */
interface InputState {
  readonly draft: string
  readonly imageIds: readonly unknown[]
  readonly occurrences: readonly { readonly hint?: string }[]
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  readonly draftRev: number
  readonly queue: readonly unknown[]
}

vi.mock('../src/client/enhance-client', () => ({
  EnhanceClientError: class extends Error {
    detail: { code: string; message: string }
    constructor(detail: { code: string; message: string }) {
      super(detail.message)
      this.detail = detail
    }
  },
  requestEnhance: vi.fn(),
  requestEnhanceStream: vi.fn(),
}))

const t = ((key: string, params?: Record<string, unknown>): string => {
  let s = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) s = s.split(`{${name}}`).join(String(value))
  return s
}) as TranslateNS<'prompt-enhance'>

/** Minimal fake of the per-session input machine store: synchronous, like the real one. */
function makeFakeInput(initial: Partial<InputState> & { draft: string }) {
  let state: InputState = {
    phase: 'plain',
    occurrences: [],
    imageIds: [],
    draftRev: 0,
    queue: [],
    ...initial,
  } as InputState
  const subscribers = new Set<() => void>()
  function useInput<S>(selector: (s: InputState) => S): S {
    return useSyncExternalStore(
      (onStoreChange) => {
        subscribers.add(onStoreChange)
        return () => {
          subscribers.delete(onStoreChange)
        }
      },
      () => selector(state),
    )
  }
  return {
    useInput,
    /** Simulate one machine publish: new snapshot object, all subscribers notified. */
    set(partial: Partial<InputState>): void {
      state = { ...state, ...partial }
      for (const notify of subscribers) notify()
    },
  }
}

function renderComposer(
  input: ReturnType<typeof makeFakeInput>,
  inputActions: Parameters<typeof EnhanceButton>[0]['inputActions'],
  sessionId: string | undefined,
): void {
  const props = { t, sessionId, useInput: input.useInput, inputActions } as never
  render(
    <>
      <EnhanceButton {...props} />
      <UndoBar {...props} />
    </>,
  )
}

const enhanceButton = (): HTMLButtonElement => screen.getByRole('button', { name: zh['button.title'] }) as HTMLButtonElement

// The one-shot path is the baseline every existing assertion was written
// against; the incremental path gets its own describe with streaming on.
// Every case starts on the 系统 tier: that is the ONLY mode that still opens
// the preview panel (the shorter tiers write straight into the draft), so the
// assertions below keep describing the panel contract instead of being
// rewritten around the one-click one.
beforeEach(() => {
  vi.mocked(requestEnhance).mockReset()
  vi.mocked(requestEnhanceStream).mockReset()
  setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: false, defaultTier: 'system' })
})

describe('dsh 0.1.2-rc.1 dual-compat (host omits sessionId)', () => {
  afterEach(cleanup)

  // rc.1 dropped `sessionId` from the input slot standard props. The button
  // (input.right) and the undo bar (input.dock) are separate component trees,
  // so both must still land on the SAME fallback key — otherwise the undo bar
  // silently never appears after an apply.
  it('keys the button and the undo bar to the same composer and drops the session route', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, undefined)
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })

    fireEvent.click(enhanceButton())
    expect(await screen.findByText('增强文本')).toBeTruthy()
    // No host id → the server degrades to the harness default model route.
    expect(requestEnhance).toHaveBeenCalledWith(
      { sessionId: undefined, text: '旧原文', tier: 'system', useContext: true },
      expect.anything(),
    )

    fireEvent.click(screen.getByRole('button', { name: zh['panel.apply'] }))
    expect(setDraft).toHaveBeenCalledWith('增强文本')
    expect(screen.getByText(zh['undo.applied'])).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh['undo.undo'] }))
    expect(setDraft).toHaveBeenLastCalledWith('旧原文')
    expect(screen.queryByText(zh['undo.applied'])).toBeNull()
  })
})

describe('EnhanceButton guard chain', () => {
  afterEach(cleanup)

  it('refuses an empty draft with the localized empty message', () => {
    const input = makeFakeInput({ draft: '   ' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    fireEvent.click(enhanceButton())
    expect(screen.getByText(zh['error.empty'])).toBeTruthy()
    expect(requestEnhance).not.toHaveBeenCalled()
  })

  it('refuses image-only drafts', () => {
    const input = makeFakeInput({ draft: '', imageIds: ['img1' as never] })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    fireEvent.click(enhanceButton())
    expect(screen.getByText(zh['error.imagesOnly'])).toBeTruthy()
  })

  it('refuses drafts containing reference chips', () => {
    const input = makeFakeInput({ draft: '文本', occurrences: [{}] as never })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    fireEvent.click(enhanceButton())
    expect(screen.getByText(zh['error.occurrences'])).toBeTruthy()
  })

  // Regression: `imageIds` / `occurrences` are part of the input snapshot in
  // the dsh lines this plugin was written against, but a slot host need not
  // expose them. Reading `.length` off a missing field throws DURING RENDER,
  // and React answers that by unmounting the whole slot entry behind its error
  // boundary — the composer silently loses the button and the console fills
  // with a stack trace (observed live as
  // "slot entry crashed in 'conversation.input.right'").
  it('renders when the host input state omits imageIds and occurrences', () => {
    const input = makeFakeInput({ draft: '旧原文' })
    const bare = {
      useInput: <S,>(selector: (s: { draft: string; phase: string }) => S): S => selector({ draft: '旧原文', phase: 'plain' }),
      set: () => {},
    }
    expect(() => {
      render(
        <>
          <EnhanceButton {...({ t, sessionId: 's1', useInput: bare.useInput, inputActions: { setDraft: vi.fn() } } as never)} />
          <UndoBar {...({ t, sessionId: 's1', useInput: bare.useInput, inputActions: { setDraft: vi.fn() } } as never)} />
        </>,
      )
    }).not.toThrow()
    // The button is on screen and none of the advisory guards misfired.
    expect(enhanceButton()).toBeTruthy()
    expect(screen.queryByText(zh['error.imagesOnly'])).toBeNull()
    expect(screen.queryByText(zh['error.occurrences'])).toBeNull()
    expect(input).toBeDefined()
  })
})

describe('enhance → apply → undo loop', () => {
  afterEach(cleanup)

  it('runs the full loop: loading → result → apply fills back and raises the undo bar → undo restores', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 's1')
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })

    fireEvent.click(enhanceButton())
    expect(await screen.findByText('增强文本')).toBeTruthy()
    expect(requestEnhance).toHaveBeenCalledWith(
      { sessionId: 's1', text: '旧原文', tier: 'system', useContext: true },
      expect.anything(),
    )

    fireEvent.click(screen.getByRole('button', { name: zh['panel.apply'] }))
    expect(setDraft).toHaveBeenCalledWith('增强文本')
    // The undo bar must survive React batching: the pushed entry stays even
    // though the draft just changed to the applied text (regression lock for
    // the apply → pushUndo → setDraft → UndoBar ordering).
    expect(screen.getByText(zh['undo.applied'])).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh['undo.undo'] }))
    expect(setDraft).toHaveBeenLastCalledWith('旧原文')
    expect(screen.queryByText(zh['undo.applied'])).toBeNull()
  })

  it('marks the result stale (both ways) when the draft changes after the request started', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })

    fireEvent.click(enhanceButton())
    await screen.findByText('增强文本')
    // User edits during the result view → stale warning appears…
    act(() => { input.set({ draft: '编辑后的新文本' }) })
    expect(await screen.findByText(`⚠ ${zh['panel.stale.warn']}`)).toBeTruthy()
    // …and disappears again when the draft matches the source text.
    act(() => { input.set({ draft: '旧原文' }) })
    await screen.findByText(zh['panel.enhanced'])
    expect(screen.queryByText(`⚠ ${zh['panel.stale.warn']}`)).toBeNull()
  })

  it('applying over a diverged draft pushes the CURRENT draft as undo original', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 's1')
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })

    fireEvent.click(enhanceButton())
    await screen.findByText('增强文本')
    act(() => { input.set({ draft: '用户编辑的新文本' }) })
    fireEvent.click(screen.getByRole('button', { name: zh['panel.apply'] }))
    expect(setDraft).toHaveBeenLastCalledWith('增强文本')
    // Undo restores the user's latest edits, not the stale pre-enhance text.
    fireEvent.click(screen.getByRole('button', { name: zh['undo.undo'] }))
    expect(setDraft).toHaveBeenLastCalledWith('用户编辑的新文本')
  })

  it('ignores a click while this session is already enhancing (no orphaned panel swap)', async () => {
    const input = makeFakeInput({ draft: '草稿' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    vi.mocked(requestEnhance).mockReturnValue(new Promise(() => {}))

    fireEvent.click(enhanceButton())
    expect(await screen.findByText(zh['panel.loading'])).toBeTruthy()
    fireEvent.click(enhanceButton())
    // The loading panel is untouched — no error panel swap, request not orphaned.
    expect(screen.getByText(zh['panel.loading'])).toBeTruthy()
    expect(screen.queryByText(zh['error.phase'])).toBeNull()
  })
})

describe('incremental streaming display', () => {
  afterEach(cleanup)

  it('shows partial text while the call is in flight and settles on the final body', async () => {
    // Streaming is a 系统档-only path now: the shorter tiers write straight
    // into the draft, so there is no partial text to render while loading.
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: true, defaultTier: 'system' })
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's2')
    const result = { text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 }
    let release!: (value: typeof result) => void
    const gate = new Promise<typeof result>((resolve) => { release = resolve })
    vi.mocked(requestEnhanceStream).mockImplementation(async (_body, options) => {
      options.onDelta('增强')
      return gate
    })

    fireEvent.click(enhanceButton())
    // The first tokens are on screen long before the call settles.
    expect(await screen.findByText('增强')).toBeTruthy()
    expect(screen.getByText(zh['panel.streaming'])).toBeTruthy()
    expect(requestEnhance).not.toHaveBeenCalled()

    release(result)
    // …and the settled panel replaces the partial view with the real result.
    expect(await screen.findByText(zh['panel.enhanced'])).toBeTruthy()
    expect(screen.queryByText(zh['panel.streaming'])).toBeNull()
  })

  it('drops deltas that arrive after the panel moved on', async () => {
    ui.openLoading({ sessionId: 'late', original: 'x', abort: () => {} })
    ui.settleResult('late', { text: 'done', provider: 'p', model: 'm', elapsedMs: 1 })
    ui.appendDelta('late', 'stale text')
    // The stale delta is buffered behind a microtask flush; the panel must
    // still be streaming-undefined after the flush has run.
    await Promise.resolve()
    expect(ui.getPanel()?.streaming).toBeUndefined()
    ui.closePanel()
  })

  // Regression for the P1-1 batching optimization: 50 deltas in the same JS
  // turn must collapse into a single panelState mutation + one subscriber
  // notification, so React re-renders the preview panel exactly once instead
  // of 50 times during a fast model's first second of output.
  it('batches many same-turn deltas into a single panel update', async () => {
    const listener = vi.fn()
    const unsubscribe = ui.subscribe(listener)
    try {
      ui.openLoading({ sessionId: 'batch', original: 'x', abort: () => {} })
      const beforeBatching = listener.mock.calls.length
      for (let i = 0; i < 50; i++) ui.appendDelta('batch', `tok${i} `)
      // Synchronously, the panel is still the pre-batch snapshot — the
      // batching has scheduled the flush but not run it.
      expect(ui.getPanel()?.streaming).toBeUndefined()
      // No listener fire happened yet: the buffer absorbed everything.
      expect(listener.mock.calls.length).toBe(beforeBatching)
      await Promise.resolve()
      expect(ui.getPanel()?.streaming).toBe('tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok16 tok17 tok18 tok19 tok20 tok21 tok22 tok23 tok24 tok25 tok26 tok27 tok28 tok29 tok30 tok31 tok32 tok33 tok34 tok35 tok36 tok37 tok38 tok39 tok40 tok41 tok42 tok43 tok44 tok45 tok46 tok47 tok48 tok49 ')
      // One notify for the whole batch, not 50.
      expect(listener.mock.calls.length).toBe(beforeBatching + 1)
    } finally {
      unsubscribe()
      ui.closePanel()
    }
  })
})

/**
 * The one-click contract: the shorter tiers never open the preview overlay.
 * The model's rewrite lands in the draft directly, a dock row confirms it, and
 * Ctrl+Z puts the previous draft back.
 */
describe('direct fill (基础/标准/专业)', () => {
  afterEach(() => {
    cleanup()
    ui.setNotice(undefined)
  })

  it('replaces the draft without opening the panel, and Ctrl+Z restores it', async () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: false, defaultTier: 'standard' })
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 'sf')
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })

    fireEvent.click(enhanceButton())
    await screen.findByText(zh['undo.applied'])
    // The draft itself now holds the rewrite; no overlay was ever mounted.
    expect(setDraft).toHaveBeenCalledWith('增强文本')
    expect(screen.queryByText(zh['panel.enhanced'])).toBeNull()
    // Streaming off: with it on the deltas are typed into the box instead.
    expect(requestEnhanceStream).not.toHaveBeenCalled()
    expect(requestEnhance).toHaveBeenCalledWith(
      { sessionId: 'sf', text: '旧原文', tier: 'standard', useContext: true },
      expect.anything(),
    )

    // Ctrl+Z is the documented way back and consumes nothing from the browser
    // while the draft is untouched.
    let undone = false
    act(() => { undone = ui.undoTarget() })
    expect(undone).toBe(true)
    expect(setDraft).toHaveBeenLastCalledWith('旧原文')
    expect(screen.queryByText(zh['undo.applied'])).toBeNull()
  })

  it('leaves Ctrl+Z alone once the user edits the filled draft', async () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: false, defaultTier: 'standard' })
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 'sg')
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })

    fireEvent.click(enhanceButton())
    await screen.findByText(zh['undo.applied'])
    act(() => { input.set({ draft: '增强文本，我又补了一句' }) })
    // The entry no longer describes the live draft, so the key falls through
    // to the browser's own per-character undo instead of clobbering typing.
    expect(ui.undoTarget()).toBe(false)
  })

  it('reports a failure inline instead of opening an error overlay', async () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: false, defaultTier: 'standard' })
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 'sh')
    vi.mocked(requestEnhance).mockRejectedValue(new Error('boom'))

    fireEvent.click(enhanceButton())
    // A non-protocol throw is reported as the generic internal failure: the
    // notice never leaks a raw JS error string into the composer.
    const row = await screen.findByRole('status')
    expect(row.textContent).toContain(zh['error.internal'])
    expect(screen.queryByText(zh['panel.title'])).toBeNull()
  })

  it('promotes to the panel when the draft moved during the request', async () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: false, defaultTier: 'standard' })
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 'si')
    let release!: (value: { text: string; provider: string; model: string; elapsedMs: number }) => void
    const gate = new Promise<Parameters<typeof release>[0]>((resolve) => { release = resolve })
    vi.mocked(requestEnhance).mockReturnValue(gate)

    fireEvent.click(enhanceButton())
    act(() => { input.set({ draft: '用户新打的一段字' }) })
    release({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })
    // Overwriting now would destroy what the user typed after the click, so
    // the result waits in the overlay for an explicit apply.
    expect(await screen.findByText(zh['panel.apply'])).toBeTruthy()
    expect(setDraft).not.toHaveBeenCalled()
  })

  // Regression lock: direct fills used to stream their deltas straight into the
  // composer. Every delta is a full `setDraft` (re-render + height recompute +
  // caret to the end), so a long rewrite stuttered and fought the user for the
  // box. A direct run must therefore take the one-shot path and touch the draft
  // exactly once, even with streaming enabled.
  it('writes the composer exactly once, after the whole rewrite, even with streaming on', async () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: true, defaultTier: 'standard' })
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 'sj')
    const result = { text: '增强后的完整文本', provider: 'p', model: 'm', elapsedMs: 5 }
    let release!: (value: typeof result) => void
    const gate = new Promise<typeof result>((resolve) => { release = resolve })
    vi.mocked(requestEnhance).mockReturnValue(gate)

    fireEvent.click(enhanceButton())
    // The in-flight feedback is the dock row, not a half-written draft.
    await screen.findByText(zh['working.label'])
    expect(requestEnhanceStream).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()

    act(() => { release(result) })
    await screen.findByText(zh['undo.applied'])
    expect(setDraft).toHaveBeenCalledTimes(1)
    expect(setDraft).toHaveBeenLastCalledWith('增强后的完整文本')
    expect(screen.queryByText(zh['panel.enhanced'])).toBeNull()
  })

  it('never touches the composer when a direct run fails', async () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: true, defaultTier: 'standard' })
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 'sk')
    vi.mocked(requestEnhance).mockRejectedValue(new Error('boom'))

    fireEvent.click(enhanceButton())
    const row = await screen.findByRole('status')
    expect(row.textContent).toContain(zh['error.internal'])
    // Nothing was written before the result arrived, so there is nothing to roll
    // back — and definitely no truncated rewrite left sitting in the box.
    expect(setDraft).not.toHaveBeenCalled()
  })
})

describe('in-flight feedback for direct runs', () => {
  afterEach(() => {
    cleanup()
    ui.setNotice(undefined)
  })

  // A direct run has no overlay, so without a dock line the only sign of life
  // is the button spinner — which on a slow model reads as "nothing happened".
  it('raises a working row with elapsed seconds while the one-shot request is in flight', async () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: false, defaultTier: 'standard' })
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 'sx')
    let release!: (value: { text: string; provider: string; model: string; elapsedMs: number }) => void
    const gate = new Promise<Parameters<typeof release>[0]>((resolve) => { release = resolve })
    vi.mocked(requestEnhance).mockReturnValue(gate)

    fireEvent.click(enhanceButton())
    expect(await screen.findByText(zh['working.label'])).toBeTruthy()
    // The clock renders from the first second on, so the row can never be a
    // static label that a frozen run would impersonate.
    expect(screen.getByText('0 秒')).toBeTruthy()
    // The undo line never competes with it for the same row.
    expect(screen.queryByText(zh['undo.applied'])).toBeNull()

    act(() => { release({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 }) })
    await screen.findByText(zh['undo.applied'])
    expect(screen.queryByText(zh['working.label'])).toBeNull()
  })

  it('cancels a direct run from the dock row without reporting a failure', async () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: false, defaultTier: 'standard' })
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 'sy')
    let rejectRun!: (reason: unknown) => void
    vi.mocked(requestEnhance).mockReturnValue(
      new Promise<never>((_resolve, fail) => { rejectRun = fail }) as never,
    )

    fireEvent.click(enhanceButton())
    fireEvent.click(await screen.findByRole('button', { name: zh['working.cancel'] }))
    // Closing the panel aborts the request; the rejection that follows IS the
    // cancellation and must not surface as an error notice.
    act(() => { rejectRun(new Error('aborted')) })
    await vi.waitFor(() => {
      expect(screen.queryByText(zh['working.label'])).toBeNull()
    })
    expect(screen.queryByText(zh['error.internal'])).toBeNull()
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('keeps the dock silent in panel mode — the overlay is its progress indicator', async () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: false, defaultTier: 'system' })
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 'sz')
    vi.mocked(requestEnhance).mockReturnValue(new Promise(() => {}) as never)

    fireEvent.click(enhanceButton())
    expect(await screen.findByText(zh['panel.loading'])).toBeTruthy()
    expect(screen.queryByText(zh['working.label'])).toBeNull()
  })
})

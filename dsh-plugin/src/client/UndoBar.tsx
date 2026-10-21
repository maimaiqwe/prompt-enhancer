/**
 * The composer dock line (conversation.input.dock): one quiet row above the
 * input card that carries every outcome of a one-click enhancement.
 *
 * Three states share the row, in priority order:
 *
 * - **working** — a `direct` run is in flight. That mode replaces the draft
 *   without an overlay, so without this row the only feedback is the button
 *   spinner; on a slow model that reads as "the click did nothing". It shows
 *   elapsed seconds and a cancel affordance, so a run that hangs is escapable
 *   without reloading.
 * - **applied** — a result replaced the draft: a confirmation with a
 *   single-click restore (and the Ctrl+Z hint). It hides itself once the draft
 *   diverges from the applied text (the user kept typing) — the entry is
 *   dropped, so the line can never restore stale text over newer edits.
 * - **failed** — a `direct` run failed: the reason, since that mode has no
 *   overlay to show it in.
 * @module dsh-prompt-enhance/client/UndoBar
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import * as ui from './ui-state'
import { useSessionKey } from './session-key'
import { resolveComposerBox } from './anchor'

/** Props of the input.dock entry: the InputZone owner share + session kit + locale seat. */
export type UndoBarProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'prompt-enhance'>

/**
 * Seconds since the run this component is watching started.
 *
 * The clock is derived from a ref captured on the first render of the run, not
 * from the panel state, so a re-render for an unrelated reason (a streamed
 * delta, the draft changing) does not restart it. Ticking at 1 Hz keeps the
 * re-render cost negligible while still proving the run is alive.
 * @param active - whether a run is in flight; resets the clock when it ends.
 * @returns whole elapsed seconds, or 0 while idle.
 */
function useElapsedSeconds(active: boolean): number {
  const startRef = useRef<number | undefined>(undefined)
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) {
      startRef.current = undefined
      setSeconds(0)
      return
    }
    startRef.current ??= Date.now()
    setSeconds(Math.floor((Date.now() - startRef.current) / 1000))
    const timer = setInterval(() => {
      if (startRef.current === undefined) return
      setSeconds(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [active])
  return seconds
}

/**
 * The content box a full-width block child would occupy inside its parent.
 *
 * Measuring the offset against the ROW is circular: the row's own left edge is
 * exactly what the offset moves, so a row that CSS has already centred reports
 * an offset of zero and the inline style then shoves it to the far left. The
 * reference has to be the container's content box, which the row does not move.
 * @param element - the row being aligned.
 * @returns the content-box left and width in viewport pixels, or undefined without a parent.
 */
function contentBoxOf(element: HTMLElement): { readonly left: number; readonly width: number } | undefined {
  const parent = element.parentElement
  if (parent === null) return undefined
  const view = element.ownerDocument.defaultView
  if (view === null) return undefined
  const style = view.getComputedStyle(parent)
  const px = (raw: string): number => {
    const value = Number.parseFloat(raw)
    return Number.isFinite(value) ? value : 0
  }
  const rect = parent.getBoundingClientRect()
  const left = px(style.borderLeftWidth) + px(style.paddingLeft)
  const right = px(style.borderRightWidth) + px(style.paddingRight)
  return { left: rect.left + left, width: rect.width - left - right }
}

/**
 * Align a dock row with the composer card it reports on.
 *
 * The dock slot spans the whole composer seat while the card itself is centred
 * and narrower, so a row that simply fills the slot starts to the left of the
 * box it is talking about. The offset is measured instead of guessed: the card
 * is found through the shell's stable `[data-composer-card]` marker and its
 * left edge is expressed relative to the row's container (see
 * {@link contentLeftOf} for why the row itself cannot be the reference).
 *
 * Nothing is applied until a card is actually measured, so a host that renders
 * no card (or a layout the measurement cannot resolve) keeps the plain
 * full-width row rather than a made-up indent.
 *
 * The measured style is stored as a primitive key and only re-applied when it
 * changes. That is not an optimisation: writing a fresh object on every pass
 * re-renders, which re-runs the measurement, which writes again — an infinite
 * loop that ends with React unmounting the row behind its error boundary, so
 * the status line vanished instead of moving.
 * @param rowRef - the row being aligned.
 * @returns the inline style to apply, or undefined while unmeasured.
 */
function useComposerAlign(rowRef: { readonly current: HTMLElement | null }): CSSProperties | undefined {
  const [align, setAlign] = useState<{ readonly key: string; readonly style: CSSProperties } | undefined>(undefined)
  // The element the last measurement ran against. The three states swap the row
  // node, so a plain "measure on every render" is right for correctness but
  // wasteful for the common case (same node, unrelated re-render) — and every
  // measurement forces a layout read.
  const measuredRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef(0)
  const measure = useCallback((): void => {
    const row = rowRef.current
    if (row === null) return
    measuredRef.current = row
    const box = resolveComposerBox(row)
    if (box === undefined) {
      setAlign((previous) => (previous === undefined ? previous : undefined))
      return
    }
    const content = contentBoxOf(row)
    if (content === undefined) {
      setAlign((previous) => (previous === undefined ? previous : undefined))
      return
    }
    // Clamped at zero: a card wider than the slot (a zoomed-out layout) must not
    // push the text off-screen to the left. The width is clamped to the content
    // box for the mirror case: when the card is wider than the seat, an
    // unclamped width would overflow it and the row would wrap.
    const inset = Math.max(0, Math.round(box.left - content.left))
    const width = Math.round(Math.min(box.width, content.width))
    // Sub-pixel jitter must not count as a change, or a scroll that moves the
    // card by 0.3px would restart the write loop this hook exists to avoid.
    const key = `${width}:${inset}`
    setAlign((previous) => (previous?.key === key
      ? previous
      // A plain px width plus max-width, not min(100%, Npx): the clamp is the
      // same, and it survives DOM implementations that drop unsupported CSS
      // functions from an inline style.
      : { key, style: { width: `${width}px`, maxWidth: '100%', marginInlineStart: `${inset}px`, marginInlineEnd: 'auto' } }))
  }, [rowRef])
  /**
   * Coalesce a burst of scroll/resize events into one measurement per frame.
   *
   * A scroll fires dozens of times per gesture and each measurement reads two
   * layouts, so measuring inline would run the whole thing during scrolling —
   * exactly when the main thread is already busy. The row only has to be right
   * by the time the frame paints.
   */
  const schedule = useCallback((): void => {
    if (frameRef.current !== 0) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      measure()
    })
  }, [measure])
  // Layout effect: the row must be aligned in the same frame it appears, or it
  // flashes at the wrong offset for one paint before snapping right. Runs every
  // render because the state swap replaces the node, but skips the work when
  // the node is the one already measured.
  useLayoutEffect(() => {
    if (measuredRef.current === rowRef.current && align !== undefined) return
    measure()
  })
  useEffect(() => {
    const row = rowRef.current
    if (row === null) return
    // The card moves with the window and with the conversation scroll (the
    // composer is sticky), so both are followed; capture phase catches the
    // scroll of the scrollport, which does not bubble.
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer?.observe(row)
    return () => {
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      observer?.disconnect()
      if (frameRef.current !== 0) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
    }
  }, [schedule, rowRef])
  return align?.style
}

/** One session's dock row. */
export function UndoBar(props: UndoBarProps): ReactNode {
  const { t, sessionId, session, useInput, inputActions } = props
  // Same resolution as the button: the snapshot id when the host provides one,
  // otherwise the legacy field, otherwise a per-mount fallback.
  const uiKey = useSessionKey({ sessionId, session }, inputActions)
  // Defensive like the button: a host that omits `draft` must not make the
  // applied/current comparison read `undefined` as "the user kept typing" and
  // silently drop an undo entry.
  const draft = useInput((state) => {
    const value = (state as { draft?: unknown }).draft
    return typeof value === 'string' ? value : ''
  })
  useSyncExternalStore(ui.subscribe, ui.getVersion)
  const entry = ui.peekUndo(uiKey)
  const notice = ui.getNotice()
  const panel = ui.getPanel()
  // A panel-phase run owns the overlay (there the overlay is the progress
  // indicator); this row speaks only for `direct`, which has no overlay.
  const running = panel !== undefined && panel.sessionId === uiKey && panel.phase === 'loading' && panel.mode === 'direct'
  const seconds = useElapsedSeconds(running)
  // All three states share one row position, so one ref covers them: whichever
  // state is on screen is measured against the card before it paints.
  const rowRef = useRef<HTMLDivElement | null>(null)
  const alignStyle = useComposerAlign(rowRef)

  // The draft moved on (user edited after applying): drop the stale entry.
  useEffect(() => {
    if (entry !== undefined && entry.applied !== draft) ui.popUndo(uiKey)
  }, [draft, entry, uiKey])

  if (running) {
    return (
      <div className="dsh-pe-working" role="status" aria-live="polite" ref={rowRef} style={alignStyle}>
        <span className="dsh-pe-ring" aria-hidden />
        <span className="dsh-pe-working-label">{t('working.label')}</span>
        <span className="dsh-pe-working-elapsed">{t('working.elapsed', { seconds })}</span>
        <button
          type="button"
          className="dsh-pe-working-x"
          aria-label={t('working.cancel')}
          title={t('working.cancel')}
          onClick={() => ui.closePanel()}
        >✕</button>
      </div>
    )
  }

  if (entry === undefined || entry.applied !== draft) {
    if (notice === undefined || notice.sessionId !== uiKey) return null
    return (
      <div className="dsh-pe-notice" role="status" ref={rowRef} style={alignStyle}>
        <span className="dsh-pe-notice-icon" aria-hidden>!</span>
        <span className="dsh-pe-notice-text">{notice.text}</span>
        <button
          type="button"
          className="dsh-pe-undo-x"
          aria-label={t('notice.dismiss')}
          onClick={() => ui.clearNotice(uiKey)}
        >✕</button>
      </div>
    )
  }

  const undo = (): void => {
    inputActions.setDraft(entry.original)
    ui.popUndo(uiKey)
  }
  const dismiss = (): void => {
    ui.popUndo(uiKey)
  }

  return (
    <div className="dsh-pe-undo" ref={rowRef} style={alignStyle}>
      <span className="dsh-pe-undo-check" aria-hidden>✓</span>
      <span>{t('undo.applied')}</span>
      <button type="button" className="dsh-pe-undo-link" onClick={undo}>{t('undo.undo')}</button>
      <span className="dsh-pe-undo-hint">{t('undo.hint')}</span>
      <button type="button" className="dsh-pe-undo-x" aria-label={t('undo.dismiss')} onClick={dismiss}>✕</button>
    </div>
  )
}

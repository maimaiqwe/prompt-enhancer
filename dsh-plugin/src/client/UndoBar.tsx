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

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import * as ui from './ui-state'
import { useSessionKey } from './session-key'

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

/** One session's dock row. */
export function UndoBar(props: UndoBarProps): ReactNode {
  const { t, sessionId, useInput, inputActions } = props
  // 0.1.1-rc.2 carries sessionId on the props; 0.1.2-rc.1 dropped it. Use the
  // host id for UI keying when present, else a stable per-mount fallback.
  const uiKey = useSessionKey(sessionId, inputActions)
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

  // The draft moved on (user edited after applying): drop the stale entry.
  useEffect(() => {
    if (entry !== undefined && entry.applied !== draft) ui.popUndo(uiKey)
  }, [draft, entry, uiKey])

  if (running) {
    return (
      <div className="dsh-pe-working" role="status" aria-live="polite">
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
      <div className="dsh-pe-notice" role="status">
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
    <div className="dsh-pe-undo">
      <span className="dsh-pe-undo-check" aria-hidden>✓</span>
      <span>{t('undo.applied')}</span>
      <button type="button" className="dsh-pe-undo-link" onClick={undo}>{t('undo.undo')}</button>
      <span className="dsh-pe-undo-hint">{t('undo.hint')}</span>
      <button type="button" className="dsh-pe-undo-x" aria-label={t('undo.dismiss')} onClick={dismiss}>✕</button>
    </div>
  )
}

/**
 * The composer dock line (conversation.input.dock): one quiet row above the
 * input card that carries the two outcomes of a one-click enhancement.
 *
 * - After a result replaced the draft: a confirmation with a single-click
 *   restore (and the Ctrl+Z hint). It hides itself once the draft diverges
 *   from the applied text (the user kept typing) — the entry is dropped, so
 *   the line can never restore stale text over newer edits.
 * - After a `direct` run failed: the reason, since that mode has no overlay
 *   to show it in. Without this the button would appear to do nothing.
 *
 * Both are the same row; whichever applies is rendered, the undo entry first
 * (it is the more time-sensitive of the two).
 * @module dsh-prompt-enhance/client/UndoBar
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import * as ui from './ui-state'
import { useSessionKey } from './session-key'

/** Props of the input.dock entry: the InputZone owner share + session kit + locale seat. */
export type UndoBarProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'prompt-enhance'>

/** One session's undo affordance. */
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

  // The draft moved on (user edited after applying): drop the stale entry.
  useEffect(() => {
    if (entry !== undefined && entry.applied !== draft) ui.popUndo(uiKey)
  }, [draft, entry, uiKey])

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

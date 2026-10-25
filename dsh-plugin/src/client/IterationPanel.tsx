/**
 * The iteration overlay: a two-column workbench opened from the composer's
 * iterate button. The left column stacks the editable base pane (prefilled
 * from the composer draft, or the last enhanced result when the box is empty)
 * and a smaller requirement box below it; the right column is the output.
 * Three actions: run the iteration, replace the composer draft with the
 * (possibly hand-edited) output, clear all panes.
 *
 * Base lifecycle: the panel persists its panes per session and restores them
 * only while the composer draft is unchanged — once the draft changes, the
 * base re-inherits the composer (or the last result when the box is empty).
 * An empty requirement means a plain enhancement of the base; with no base at
 * all the requirement box becomes the fresh draft.
 * @module dsh-prompt-enhance/client/IterationPanel
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { EnhanceRequestBody } from '../shared/protocol'
import { EnhanceClientError, requestEnhanceStream } from './enhance-client'
import { localizedErrorMessage } from './ResultPanel'
import { effectiveTier, getVersion, subscribe as subscribeTier } from './tier-store'
import { clearIterPanel, lastEnhancedOf, loadIterPanel, recordLastEnhanced, saveIterPanel } from './iter-state'

/** Minimal surface of the composer actions the panel needs. */
export interface IterationPanelActions {
  setDraft: (text: string) => void
}

/** Props of the iteration overlay. */
export interface IterationPanelProps {
  t: TranslateNS<'prompt-enhance'>
  uiKey: string
  wireId: string | undefined
  inputActions: IterationPanelActions
  draft: string
  onClose: () => void
}

/** The two-column iterate workbench, rendered as a body portal. */
export function IterationPanel(props: IterationPanelProps): ReactNode {
  const { t, uiKey, wireId, inputActions, draft, onClose } = props
  const last = lastEnhancedOf(uiKey)
  // Base resolution at open time: the persisted panes win while the composer
  // draft is unchanged; a changed draft re-inherits the composer, falling back
  // to the last enhanced result only when the box is empty.
  const restored = useRef(loadIterPanel(uiKey, draft)).current
  const [base, setBase] = useState(restored?.base ?? (draft.trim() !== '' ? draft : last ?? ''))
  const [input, setInput] = useState(restored?.input ?? '')
  const [output, setOutput] = useState(restored?.output ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  // Tier is read live at call time: switching the capsule mid-way only affects
  // the next run, never text already typed into the panes.
  useSyncExternalStore(subscribeTier, getVersion)
  const tier = effectiveTier(uiKey)
  const positive = base.trim() === ''
  // Provenance of the current base text, judged against its possible origins.
  const baseSource = positive
    ? t('iter.panel.base.none')
    : base === draft ? t('iter.panel.base.draft')
    : last !== undefined && base === last ? t('iter.panel.base.last')
    : t('iter.panel.base.custom')

  useEffect(() => {
    saveIterPanel(uiKey, { base, input, output, draft })
  }, [uiKey, base, input, output, draft])

  useEffect(() => () => {
    controllerRef.current?.abort()
  }, [])

  // Esc closes the workbench — but never while a run is in flight, so an
  // accidental press cannot masquerade as a cancel of a request the user
  // still wants. The capture phase keeps the host's own key handling out of
  // the way only for this one key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key !== 'Escape' || busy) return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])

  const run = async (): Promise<void> => {
    if (busy) return
    // Empty panes are only fatal when there is nothing to work on at all; with
    // a base present an empty requirement means "plain enhancement of the base".
    if (positive && input.trim() === '') {
      setError(t('iter.error.empty'))
      return
    }
    setError('')
    setBusy(true)
    const controller = new AbortController()
    controllerRef.current = controller
    const sid = wireId !== undefined ? { sessionId: wireId } : {}
    const body: EnhanceRequestBody = positive
      ? { text: input, tier, ...sid }
      : { text: base, tier, ...sid, ...(input.trim() !== '' ? { iterRequirement: input } : {}) }
    try {
      const result = await requestEnhanceStream(body, {
        signal: controller.signal,
        onDelta: () => {},
      })
      setOutput(result.text)
      recordLastEnhanced(uiKey, result.text)
    } catch (error) {
      if (!controller.signal.aborted) {
        const detail = error instanceof EnhanceClientError ? error.detail : undefined
        const primary = detail !== undefined
          ? localizedErrorMessage(t, detail.code, detail.params)
          : error instanceof Error ? error.message : String(error)
        const upstream = detail?.message !== undefined && detail.message !== '' ? `\n${detail.message}` : ''
        setError(primary + upstream)
      }
    } finally {
      setBusy(false)
      controllerRef.current = null
    }
  }

  const replace = (): void => {
    if (output.trim() === '') {
      setError(t('iter.error.output'))
      return
    }
    inputActions.setDraft(output)
    recordLastEnhanced(uiKey, output)
    onClose()
  }

  const clear = (): void => {
    setBase('')
    setInput('')
    setOutput('')
    setError('')
    clearIterPanel(uiKey)
  }

  return createPortal(
    <div className="dsh-pe-iter-overlay" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="dsh-pe-iter-panel" role="dialog" aria-modal="true" aria-label={t('iter.panel.title')}>
        <header className="dsh-pe-iter-head">
          <div>
            <h3 className="dsh-pe-iter-title">{t('iter.panel.title')}</h3>
            <p className="dsh-pe-iter-base">{t('iter.panel.base', { source: baseSource })}</p>
          </div>
          <button type="button" className="dsh-pe-iter-close" aria-label={t('panel.close')} disabled={busy} onClick={onClose}>✕</button>
        </header>
        <div className="dsh-pe-iter-body">
          <div className="dsh-pe-iter-left">
            <label className="dsh-pe-iter-pane">
              <span className="dsh-pe-iter-pane-label">
                {t('iter.panel.base.label')}
                <span className="dsh-pe-iter-hint">{t('iter.panel.base.hint')}</span>
              </span>
              <textarea
                className="dsh-pe-iter-area"
                aria-label={t('iter.panel.base.label')}
                value={base}
                placeholder={t('iter.panel.base.placeholder')}
                onChange={(event) => setBase(event.target.value)}
              />
            </label>
            <label className="dsh-pe-iter-pane is-req">
              <span className="dsh-pe-iter-pane-label">{t('iter.panel.input.label')}</span>
              <textarea
                className="dsh-pe-iter-area is-req"
                aria-label={t('iter.panel.input.label')}
                value={input}
                placeholder={t('iter.panel.input.placeholder')}
                onChange={(event) => setInput(event.target.value)}
              />
            </label>
          </div>
          <span className="dsh-pe-iter-flow" aria-hidden="true">→</span>
          <div className="dsh-pe-iter-pane">
            <span className="dsh-pe-iter-pane-label">
              {t('iter.panel.output.label')}
              <span className="dsh-pe-iter-hint">{t('iter.panel.output.hint')}</span>
            </span>
            <textarea
              className="dsh-pe-iter-area is-output"
              aria-label={t('iter.panel.output.label')}
              value={output}
              spellCheck={false}
              onChange={(event) => setOutput(event.target.value)}
            />
          </div>
        </div>
        <footer className="dsh-pe-iter-foot">
          {error !== '' ? <span className="dsh-pe-iter-error" role="alert">{error}</span> : null}
          <span className="dsh-pe-iter-spacer" />
          {busy ? <button type="button" className="dsh-pe-iter-action ghost" onClick={() => controllerRef.current?.abort()}>{t('iter.panel.cancel')}</button> : null}
          <button type="button" className="dsh-pe-iter-action ghost" disabled={busy} onClick={clear}>{t('iter.panel.clear')}</button>
          <button type="button" className="dsh-pe-iter-action line" disabled={busy} onClick={replace}>{t('iter.panel.replace')}</button>
          <button type="button" className="dsh-pe-iter-action solid" disabled={busy} onClick={() => { void run() }}>
            {busy ? <span className="dsh-pe-ring dsh-pe-ring-sm" aria-hidden="true" /> : null}
            {busy ? t('iter.panel.loading') : t('iter.panel.run')}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

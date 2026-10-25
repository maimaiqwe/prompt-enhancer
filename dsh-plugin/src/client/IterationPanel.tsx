/**
 * The iteration overlay: a two-pane workbench opened from the composer's
 * iterate button. Left pane takes the directional requirement (or the draft
 * itself when there is nothing to iterate on), right pane shows the output
 * and stays editable. Three actions: run the iteration, replace the composer
 * draft with the (possibly hand-edited) output, clear both panes.
 *
 * Base resolution follows the agreed precedence: the session's last enhanced
 * result, else the current composer draft, else nothing (left pane becomes a
 * fresh draft and the call degrades to a plain enhancement). Panel contents
 * persist per session and reset when the composer draft changed in between.
 * @module dsh-prompt-enhance/client/IterationPanel
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { EnhanceRequestBody } from '../shared/protocol'
import { EnhanceClientError, requestEnhance } from './enhance-client'
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

/** The two-pane iterate workbench, rendered as a body portal. */
export function IterationPanel(props: IterationPanelProps): ReactNode {
  const { t, uiKey, wireId, inputActions, draft, onClose } = props
  const restored = useRef(loadIterPanel(uiKey, draft)).current
  const [input, setInput] = useState(restored?.input ?? '')
  const [output, setOutput] = useState(restored?.output ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  // Tier is read live at call time: switching the capsule mid-way only affects
  // the next run, never text already typed into the panes.
  useSyncExternalStore(subscribeTier, getVersion)
  const tier = effectiveTier(uiKey)
  const last = lastEnhancedOf(uiKey)
  const base = last !== undefined && last.trim() !== '' ? last : draft
  const positive = base.trim() === ''
  const baseSource = positive
    ? t('iter.panel.base.none')
    : last !== undefined && last.trim() !== '' ? t('iter.panel.base.last') : t('iter.panel.base.draft')

  useEffect(() => {
    saveIterPanel(uiKey, { input, output, draft })
  }, [uiKey, input, output, draft])

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
    if (input.trim() === '') {
      setError(t('iter.error.empty'))
      return
    }
    setError('')
    setBusy(true)
    const controller = new AbortController()
    controllerRef.current = controller
    const body: EnhanceRequestBody = positive
      ? { text: input, tier, ...(wireId !== undefined ? { sessionId: wireId } : {}) }
      : { text: base, iterRequirement: input, tier, ...(wireId !== undefined ? { sessionId: wireId } : {}) }
    try {
      const result = await requestEnhance(body, controller.signal)
      setOutput(result.text)
      recordLastEnhanced(uiKey, result.text)
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error instanceof EnhanceClientError
          ? localizedErrorMessage(t, error.detail.code, error.detail.params)
          : error instanceof Error ? error.message : String(error))
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
          <label className="dsh-pe-iter-pane">
            <span className="dsh-pe-iter-pane-label">{t('iter.panel.input.label')}</span>
            <textarea
              className="dsh-pe-iter-area"
              value={input}
              placeholder={t('iter.panel.input.placeholder')}
              autoFocus
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
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

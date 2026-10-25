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

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
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

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.35)',
  }
  const cardStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 8, minWidth: 520, maxWidth: '80vw', maxHeight: '80vh',
    padding: 16, borderRadius: 12, background: 'var(--dsh-pe-panel-bg, #fff)', color: 'inherit',
    boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  }
  const paneStyle: React.CSSProperties = {
    flex: 1, minHeight: 120, resize: 'vertical', padding: 8, borderRadius: 8, border: '1px solid rgba(128,128,128,0.4)',
    fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
  }

  return createPortal(
    <div style={overlayStyle} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div style={cardStyle} role="dialog" aria-label={t('iter.panel.title')}>
        <strong>{t('iter.panel.title')}</strong>
        <span style={{ fontSize: 12, opacity: 0.75 }}>{t('iter.panel.base', { source: baseSource })}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <span style={{ fontSize: 12 }}>{t('iter.panel.input.label')}</span>
            <textarea style={paneStyle} value={input} placeholder={t('iter.panel.input.placeholder')} onChange={(event) => setInput(event.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <span style={{ fontSize: 12 }}>{t('iter.panel.output.label')}</span>
            <textarea style={paneStyle} value={output} onChange={(event) => setOutput(event.target.value)} />
          </label>
        </div>
        {error !== '' ? <span style={{ fontSize: 12, color: '#c0392b' }} role="alert">{error}</span> : null}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" disabled={busy} onClick={() => { void run() }}>{busy ? t('iter.panel.loading') : t('iter.panel.run')}</button>
          {busy ? <button type="button" onClick={() => controllerRef.current?.abort()}>{t('iter.panel.cancel')}</button> : null}
          <button type="button" disabled={busy} onClick={replace}>{t('iter.panel.replace')}</button>
          <button type="button" disabled={busy} onClick={clear}>{t('iter.panel.clear')}</button>
          <span style={{ flex: 1 }} />
          <button type="button" disabled={busy} onClick={onClose}>{t('panel.close')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

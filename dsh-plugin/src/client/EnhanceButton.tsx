/**
 * The composer enhance button (conversation.input.right): reads the live
 * draft through the session standard kit, applies every local guard
 * (empty / over-length / images-only / command-or-reference chips / busy),
 * then calls the host route.
 *
 * Where the result lands depends on the tier:
 * - 基础/标准/专业 (the default) replace the draft the moment the answer
 *   arrives. One click in, one Ctrl+Z out — no overlay, no second click. The
 *   original draft is pushed onto the undo stack BEFORE setDraft, and a draft
 *   edited mid-flight promotes the run to the preview overlay instead of
 *   silently overwriting the typing.
 * - 系统 produces an eight-section system prompt that is far longer than the
 *   draft it came from, so it keeps the preview overlay: the user reads it and
 *   decides. That is the only tier that opens a dialog.
 *
 * The button never blocks the composer: on any failure the draft stays exactly
 * as the user typed it, and the reason lands on the composer dock line.
 * @module dsh-prompt-enhance/client/EnhanceButton
 */

import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EnhanceError } from '../shared/protocol'
import { checkInputText } from '../shared/validate'
import { onlySkillTokens } from '../shared/skill-tokens'
import { EnhanceClientError, requestEnhance, requestEnhanceStream } from './enhance-client'
import { ResultPanel, localizedErrorMessage } from './ResultPanel'
import { TierMenu } from './TierMenu'
import * as ui from './ui-state'
import { getClientSettings, subscribeClientSettings } from './settings'
import { effectiveTier, effectiveUseContext, getVersion, subscribe as subscribeTier } from './tier-store'
import { useSessionKey, serverSessionId } from './session-key'
import { recordLastEnhanced } from './iter-state'
import { IterationButton } from './IterationButton'

/** Props of the input.right entry: the InputZone owner share + session kit + locale seat. */
export type EnhanceButtonProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'prompt-enhance'>

/**
 * Read the length of an optional array-shaped field out of the host's input
 * state.
 *
 * `imageIds` and `occurrences` are part of the conversation input snapshot in
 * the dsh lines this plugin was written against, but a slot host is not
 * obliged to expose them, and reading `.length` off a missing field throws
 * *during render* — which React answers by unmounting the whole slot entry
 * behind its error boundary, so the composer loses the button and the console
 * fills with a stack trace instead of a usable feature. Reading defensively
 * turns an absent or malformed field into "no such count", which only disables
 * the corresponding advisory guard; the enhancement itself still runs.
 * @param value - the untrusted field.
 * @returns the array length, or 0 when the field is absent/not an array.
 */
function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/**
 * Read a field that downstream code requires to be a string. `draft` drives
 * `checkInputText`, which iterates the text — an absent field would throw on
 * click instead of on render, but it is the same class of brittleness against
 * an unknown host state shape.
 * @param value - the untrusted field.
 * @returns the string, or `''` when the field is absent/not a string.
 */
function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One composer's enhance trigger. */
export function EnhanceButton(props: EnhanceButtonProps): ReactNode {
  const { t, sessionId, session, useInput, inputActions } = props
  // 0.1.1-rc.2 carries `sessionId` on the props; 0.1.2-rc.1 dropped it but hands
  // every composer slot the conversation snapshot, whose `sessionId` is the real
  // one. The fallback below is per-mount, so keying on it would forget every
  // per-session pick at the next refresh.
  const sources = { sessionId, session }
  const uiKey = useSessionKey(sources, inputActions)
  const wireId = serverSessionId(sources)
  const draft = useInput((state) => stringOf((state as { draft?: unknown }).draft))
  const phase = useInput((state) => (state as { phase?: unknown }).phase)
  const occurrenceCount = useInput((state) => countOf((state as { occurrences?: unknown }).occurrences))
  const imageCount = useInput((state) => countOf((state as { imageIds?: unknown }).imageIds))
  const settings = useSyncExternalStore(subscribeClientSettings, getClientSettings)
  const panel = useSyncExternalStore(ui.subscribe, ui.getPanel)
  // Tier selection lives in its own store (persisted default + per-session
  // override); subscribing here keeps the capsule and the next request in
  // sync without threading state through props.
  useSyncExternalStore(subscribeTier, getVersion)
  const tier = effectiveTier(uiKey)
  const useContext = effectiveUseContext(uiKey)
  const rootRef = useRef<HTMLButtonElement | null>(null)
  // The live draft, readable from callbacks that were created before the user
  // typed again (the fetch settle handler, the undo entry, the Ctrl+Z target).
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  })
  const busy = panel !== undefined && panel.sessionId === uiKey && panel.phase === 'loading'
  // 系统 is the only tier that previews: its output is a full system prompt,
  // an order of magnitude longer than the draft, so replacing the box without
  // asking would be the wrong default.
  const direct = tier !== 'system'
  // The preview panel is a single shared slot, so the UI admits exactly ONE
  // in-flight enhancement at a time across all sessions: `anyBusy` disables
  // every other composer's button while one request is loading. This is
  // deliberately stricter than the host `maxConcurrent` cap (default 2) —
  // that cap protects the /enhance command plane and multi-client callers,
  // while the single-panel UI cannot show two loading states anyway.
  const anyBusy = panel !== undefined && panel.phase === 'loading'
  // The OTHER composer is the one loading. See the button render below: a
  // cross-session busy state used to disable this button with no explanation,
  // which reads as "broken" in a multi-session layout.
  const otherBusy = anyBusy && !busy

  /** Guard chain + fetch + apply transition for this session. */
  const start = useCallback((): void => {
    if (anyBusy) return
    // Refuse quietly: the notice line explains why, and an overlay for "the
    // box is empty" is exactly the interruption this mode exists to avoid.
    const reject = (message: string): void => {
      if (direct) {
        ui.setNotice({ sessionId: uiKey, kind: 'error', text: message })
        return
      }
      ui.openError(uiKey, draft, { code: 'rejected', localized: message }, 'panel')
    }
    if (!settings.enabled) {
      reject(t('error.disabled'))
      return
    }
    if (imageCount > 0 && draft.trim() === '') {
      reject(t('error.imagesOnly'))
      return
    }
    // A draft of nothing but `$skill` invocations names a Skill but states no
    // request. Refuse before spending a call — the rules forbid inventing one.
    if (onlySkillTokens(draft)) {
      reject(t('error.tokensOnly'))
      return
    }
    const check = checkInputText(draft, settings.maxInputChars)
    if (!check.ok) {
      reject(check.code === 'empty'
        ? t('error.empty')
        : t('error.tooLong', { count: check.count, max: check.max }))
      return
    }
    if (occurrenceCount > 0) {
      reject(t('error.occurrences'))
      return
    }
    if (phase !== 'plain') {
      reject(t('error.phase'))
      return
    }
    ui.clearNotice(uiKey)
    const mode: ui.PanelMode = direct ? 'direct' : 'panel'
    const controller = new AbortController()
    ui.openLoading({ sessionId: uiKey, original: draft, abort: () => controller.abort(), mode })
    // Direct fills arrive as ONE whole-text replacement, never as an incremental
    // write. Typing deltas into the composer used to look responsive, but every
    // delta is a full `setDraft` — a composer re-render, a height recompute and
    // a caret pushed to the end — so a long rewrite spent seconds stuttering and
    // fought the user for the box they were about to keep typing in. The dock
    // row (elapsed seconds + cancel) already proves the call is alive, so the
    // wait needs no typing effect to be legible.
    const settle = (result: Parameters<typeof ui.settleResult>[1]): void => {
      recordLastEnhanced(uiKey, result.text)
      if (!direct) {
        ui.settleResult(uiKey, result)
        return
      }
      // The box no longer holds the draft this run started from: replacing it
      // now would destroy typing the user did mid-flight. Promote the run to
      // the preview overlay instead, so the overwrite stays an explicit choice.
      if (draftRef.current !== draft) {
        ui.settleResult(uiKey, result, 'panel')
        return
      }
      ui.pushUndo(uiKey, { original: draft, applied: result.text })
      inputActions.setDraft(result.text)
      ui.closePanel()
    }
    const fail = (error: unknown): void => {
      // A cancelled run is not a failure: the user pressed the dock's ✕ (or
      // closed the panel), which aborts the request and rejects with an
      // AbortError. Reporting that as an internal error would blame the user
      // for the one outcome they asked for.
      if (controller.signal.aborted) {
        ui.closePanel()
        return
      }
      const detail: EnhanceError = error instanceof EnhanceClientError
        ? error.detail
        : { code: 'internal', message: error instanceof Error ? error.message : String(error) }
      if (!direct) {
        ui.settleError(uiKey, detail)
        return
      }
      // Nothing was written to the box before the result arrived, so there is
      // no half-written text to roll back — the draft is exactly as it was.
      ui.closePanel()
      ui.setNotice({
        sessionId: uiKey,
        kind: 'error',
        text: detail.localized ?? localizedErrorMessage(t, detail.code, detail.params),
      })
    }
    // The tier and the context toggle travel with the request so switching
    // either one needs no host round-trip first.
    const body = { sessionId: wireId, text: draft, tier, useContext }
    // Streaming stays a panel-mode feature: there the deltas land in an overlay
    // built for them, never in the composer. A direct run always takes the
    // one-shot path so the box is touched exactly once.
    if (settings.streaming && !direct) {
      requestEnhanceStream(body, {
        signal: controller.signal,
        onDelta: (delta) => ui.appendDelta(uiKey, delta),
      }).then(settle, fail)
      return
    }
    requestEnhance(body, controller.signal).then(settle, fail)
  }, [anyBusy, draft, direct, imageCount, occurrenceCount, phase, settings, uiKey, wireId, t, tier, useContext, inputActions])

  // The session registry holds a stable identity; run always dispatches to
  // the latest start callback. The refresh rides an effect (never the render
  // phase, which is unsafe under React 18 concurrent rendering).
  const runRef = useRef(start)
  useEffect(() => {
    runRef.current = start
  })
  useEffect(() => {
    const entry: ui.SessionEntry = {
      root: rootRef.current,
      run: () => runRef.current(),
      // Ctrl+Z target: restore the pre-enhance draft, but only while the box
      // still holds the text the enhancement put there. Once the user edits,
      // the browser's own undo is the right handler and this returns false.
      undo: (): boolean => {
        const entry = ui.peekUndo(uiKey)
        if (entry === undefined || entry.applied !== draftRef.current) return false
        inputActions.setDraft(entry.original)
        ui.popUndo(uiKey)
        ui.clearNotice(uiKey)
        return true
      },
    }
    return ui.registerSession(uiKey, entry)
  }, [inputActions, uiKey])

  // Draft changed after the request started → flag (or clear) the result
  // panel's stale marker so the user knows the result is based on the
  // pre-enhance text.
  useEffect(() => {
    if (panel !== undefined && panel.sessionId === uiKey && panel.phase === 'result') {
      ui.setStale(uiKey, draft !== panel.original)
    }
  }, [draft, panel, uiKey])

  /** Apply the enhanced result: remember the CURRENT draft (pre-apply, so
   * undo restores exactly this state even if the user typed during the
   * request), then fill the enhanced text back. */
  const apply = useCallback((): void => {
    if (panel === undefined || panel.phase !== 'result' || panel.result === undefined) return
    ui.pushUndo(uiKey, { original: draft, applied: panel.result.text })
    inputActions.setDraft(panel.result.text)
    ui.closePanel()
  }, [draft, inputActions, panel, uiKey])

  if (!settings.enabled) return null

  const owned = panel !== undefined && panel.sessionId === uiKey && panel.mode !== 'direct' ? panel : undefined
  return (
    <>
      {/* The picker sits left of ✨, the iterate trigger between them: pick a
          tier, iterate on the last result, or enhance fresh. All live in one
          inline-flex row so the composer's own spacing keeps them together. */}
      <span className="dsh-pe-cluster">
        <TierMenu sessionKey={uiKey} t={t} />
        <IterationButton
          t={t}
          sessionId={sessionId}
          session={session}
          useInput={useInput}
          inputActions={inputActions}
        />
        <button
          ref={rootRef}
          type="button"
          className={`dsh-pe-btn${busy ? ' is-busy' : ''}`}
          title={busy ? t('button.busy') : otherBusy ? t('button.otherBusy') : t('button.title')}
          aria-label={otherBusy ? t('button.otherBusy') : t('button.title')}
          // `aria-disabled` instead of `disabled`: a disabled button is skipped by
          // the keyboard and by screen readers, so the reason this composer is
          // inert (another session's enhancement occupies the single preview
          // panel) would be unreachable exactly for the users who need it. The
          // click is a no-op either way (`start` returns early on `anyBusy`).
          aria-disabled={otherBusy || undefined}
          onClick={start}
        >
          <span className="dsh-pe-btn-icon" aria-hidden>
            {busy ? <span className="dsh-pe-ring dsh-pe-ring-sm" /> : '✨'}
          </span>
        </button>
      </span>
      {owned !== undefined && (
        createPortal(
          <ResultPanel
            state={owned}
            t={t}
            anchorRef={rootRef}
            onApply={apply}
            onCancel={() => ui.closePanel()}
            onRetry={owned.phase === 'error' ? start : undefined}
          />,
          document.body,
        )
      )}
    </>
  )
}

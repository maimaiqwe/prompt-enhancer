/**
 * Module-level UI state shared by the slot components and the shortcut
 * listener: one panel state (loading/result/error + its abort controller),
 * one undo stack, and a registry of mounted per-session triggers so the
 * keyboard shortcut can find the composer the user is working in. Every
 * mutation notifies the external-store subscribers the React components
 * read through.
 * @module dsh-prompt-enhance/client/ui-state
 */

import type { EnhanceError, EnhanceResult } from '../shared/protocol'
import { createUndoStack, type UndoStack } from './undo-stack'

/**
 * How the result of one enhancement reaches the composer.
 *
 * - `panel`: the preview overlay opens and the user clicks 回填. Kept for the
 *   structured 系统 tier, where the eight-section rewrite is long enough that
 *   overwriting a one-line draft unannounced would be rude.
 * - `direct`: the result replaces the draft the moment it arrives, with the
 *   undo entry pushed first, so a single Ctrl+Z restores what was there.
 *   Loading gets only the button's spinner; no overlay, no extra click.
 */
export type PanelMode = 'panel' | 'direct'

/** What the preview panel shows for one enhancement. */
export interface PanelState {
  readonly sessionId: string
  readonly phase: 'loading' | 'result' | 'error'
  /** How the settled result reaches the composer; see `PanelMode`. */
  readonly mode?: PanelMode
  /** The draft as it was when the request started (never mutated). */
  readonly original: string
  readonly result?: EnhanceResult
  readonly error?: EnhanceError
  /** Cancels the in-flight request; absent once settled. */
  readonly abort?: () => void
  /** The composer draft changed after the request started — the result is based on the old text. */
  readonly stale?: boolean
  /**
   * Text already streamed from the model, shown while the call is still in
   * flight. Display-only: the result phase replaces it with the normalized
   * full body, which is what the user actually applies.
   */
  readonly streaming?: string
}

/** One mounted composer trigger (the input.right button's session presence). */
export interface SessionEntry {
  /** The button's root element, for focused-composer detection. */
  root: HTMLElement | null
  /** Start one enhancement for this session (guards + fetch + panel). */
  run: () => void
  /**
   * Restore this session's newest undo entry into the composer.
   * @returns true when an entry was consumed (the caller should swallow the key).
   */
  undo?: () => boolean
}

const listeners = new Set<() => void>()
let panelState: PanelState | undefined
let version = 0

/** Notify every subscriber (React external store + shortcut bookkeeping). */
function notify(): void {
  version++
  for (const listener of listeners) listener()
}

/**
 * Pending streaming delta batch. Multiple `appendDelta` calls inside the same
 * JS turn (a single model stream tick may yield several delta chunks back to
 * back) are coalesced into one `panelState` mutation + one `notify()` instead
 * of N. This caps the React re-render rate at "once per microtask" instead of
 * "once per model token", which matters on long rewrites where a fast model
 * can push 100+ tokens/second and each sync `notify` triggers a full panel
 * re-render. The trade-off: callers that read `getPanel().streaming` SYNCHRONOUSLY
 * right after `appendDelta` see the OLD value until the microtask flushes;
 * every test or component that needs the new value should `await Promise.resolve()`
 * first. In React this is automatic — the component subscribes via
 * `useSyncExternalStore` and reads during render, which runs after the
 * microtask completes.
 */
let pendingDeltaText = ''
let pendingDeltaSession: string | undefined
let pendingDeltaScheduled = false

/** Drain the pending delta into panelState and notify subscribers. */
function flushPendingDelta(): void {
  pendingDeltaScheduled = false
  if (pendingDeltaText === '' || pendingDeltaSession === undefined) return
  const sessionId = pendingDeltaSession
  const text = pendingDeltaText
  pendingDeltaText = ''
  pendingDeltaSession = undefined
  // Re-check the panel state on flush: the panel may have moved on (settled,
  // replaced, closed) between schedule and flush, in which case the batch
  // must be dropped so a late delta can never leak into another result.
  if (panelState === undefined || panelState.sessionId !== sessionId || panelState.phase !== 'loading') return
  panelState = { ...panelState, streaming: (panelState.streaming ?? '') + text }
  notify()
}

/** Schedule one microtask flush if none is already pending. */
function scheduleDeltaFlush(): void {
  if (pendingDeltaScheduled) return
  pendingDeltaScheduled = true
  queueMicrotask(flushPendingDelta)
}

/** The shared undo store (depth 3 per session). */
const undoStore: UndoStack = createUndoStack(3)

/** Remember one replacement for a session and notify subscribers. */
export function pushUndo(sessionId: string, entry: Parameters<UndoStack['push']>[1]): void {
  undoStore.push(sessionId, entry)
  notify()
}

/** Newest undo entry of a session, when one exists. */
export function peekUndo(sessionId: string): ReturnType<UndoStack['peek']> {
  return undoStore.peek(sessionId)
}

/** Remove the newest undo entry of a session and notify subscribers. */
export function popUndo(sessionId: string): ReturnType<UndoStack['pop']> {
  const entry = undoStore.pop(sessionId)
  notify()
  return entry
}

/**
 * One transient line for the composer dock: a rejection or transport failure
 * from a `direct` run, where there is no overlay to show it in. Rendering it
 * above the composer card (the slot the undo row already uses) keeps failures
 * visible without a dialog the user has to dismiss.
 */
export interface NoticeState {
  readonly sessionId: string
  /** Severity: only `error` today, kept open for future advisory copy. */
  readonly kind: 'error'
  readonly text: string
}

let notice: NoticeState | undefined

/**
 * Show (or replace) the dock notice of one session.
 * @param state - the notice to display.
 */
export function setNotice(state: NoticeState | undefined): void {
  notice = state
  notify()
}

/** Drop the dock notice when it belongs to the given session. */
export function clearNotice(sessionId: string): void {
  if (notice?.sessionId !== sessionId) return
  notice = undefined
  notify()
}

/** The current dock notice, or undefined while there is none. */
export function getNotice(): NoticeState | undefined {
  return notice
}

/** Session registry of mounted triggers; the last mounted session is the shortcut fallback. */
const sessions = new Map<string, SessionEntry>()
let lastMountedSession: string | undefined

/**
 * Subscribe to panel/undo mutations.
 * @param listener - called after every mutation.
 * @returns the unsubscribe function.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Current snapshot version (React external store change detector). */
export function getVersion(): number {
  return version
}

/** The panel state, or undefined while closed. */
export function getPanel(): PanelState | undefined {
  return panelState
}

/**
 * Abort one in-flight panel request without letting its teardown failure
 * block the transition. The panel is replaced either way: an abort callback
 * that throws must not leave the store half-mutated, or the button inert.
 * @param state - the panel being replaced/closed, when one is open.
 */
function abortOf(state: PanelState | undefined): void {
  try {
    state?.abort?.()
  } catch {
    // A dead fetch/stream is already cancelled; nothing left to do.
  }
}

/** Open (or replace) the panel in the loading phase. Any in-flight request
 * from the replaced panel is aborted first, so it cannot become an orphan. */
export function openLoading(state: Omit<PanelState, 'phase' | 'result' | 'error'>): void {
  abortOf(panelState)
  panelState = { ...state, phase: 'loading' }
  notify()
}

/**
 * Settle the open panel with a result. Ignored when the panel moved on.
 *
 * `mode` overrides how the result is presented: a `direct` run that finds the
 * draft edited mid-flight promotes itself to `panel` so the user chooses
 * whether to overwrite their newer text, instead of having it replaced silently.
 * @param sessionId - the session the panel belongs to.
 * @param result - the enhanced text plus its routing metadata.
 * @param mode - presentation override for this settle.
 */
export function settleResult(sessionId: string, result: EnhanceResult, mode?: PanelMode): void {
  if (panelState?.sessionId !== sessionId || panelState.phase !== 'loading') return
  const settled: PanelMode | undefined = mode ?? panelState.mode
  panelState = {
    sessionId,
    phase: 'result',
    original: panelState.original,
    result,
    ...settled !== undefined ? { mode: settled } : {},
  }
  notify()
}

/** Settle the open panel with an error. Ignored when the panel moved on. */
export function settleError(sessionId: string, error: EnhanceError): void {
  if (panelState?.sessionId !== sessionId || panelState.phase !== 'loading') return
  panelState = { sessionId, phase: 'error', original: panelState.original, error }
  notify()
}

/**
 * Append newly displayable text to the loading panel. Multiple calls inside
 * the same JS turn are coalesced into a single panelState mutation (see the
 * `pendingDeltaText` notes above). Dropped synchronously when the panel is
 * gone / on a different session / not in the loading phase, and dropped
 * again on flush if the panel moved on in between — so a late delta from an
 * aborted stream can never leak into another result.
 */
export function appendDelta(sessionId: string, text: string): void {
  if (text === '') return
  if (panelState === undefined || panelState.sessionId !== sessionId || panelState.phase !== 'loading') return
  pendingDeltaText += text
  pendingDeltaSession = sessionId
  scheduleDeltaFlush()
}

/**
 * Open the panel directly in the error phase (local validation failures).
 * @param sessionId - the session the panel belongs to.
 * @param original - the draft the failure was about.
 * @param error - what went wrong.
 * @param mode - presentation of the failure; `direct` runs still show the
 *   overlay here, because a rejection with no visible surface reads as
 *   "the button did nothing".
 */
export function openError(sessionId: string, original: string, error: EnhanceError, mode?: PanelMode): void {
  abortOf(panelState)
  panelState = {
    sessionId,
    phase: 'error',
    original,
    error,
    ...mode !== undefined ? { mode } : {},
  }
  notify()
}

/**
 * Flag the open result panel as stale (or clear the flag): stale means the
 * composer draft changed after the request started, so the result is based
 * on the old text. Ignored for any other phase or session.
 */
export function setStale(sessionId: string, stale: boolean): void {
  if (panelState?.sessionId !== sessionId || panelState.phase !== 'result' || panelState.stale === stale) return
  panelState = { ...panelState, stale }
  notify()
}

/** Close the panel (cancel/dismiss/apply); aborts an in-flight request. */
export function closePanel(): void {
  abortOf(panelState)
  if (panelState === undefined) return
  panelState = undefined
  notify()
}

/**
 * Register one session's mounted trigger; returns the unregister function.
 * The most recent registration becomes the shortcut's fallback target.
 */
export function registerSession(sessionId: string, entry: SessionEntry): () => void {
  sessions.set(sessionId, entry)
  lastMountedSession = sessionId
  notify()
  return () => {
    if (sessions.get(sessionId) === entry) sessions.delete(sessionId)
    if (lastMountedSession === sessionId) {
      // Fall back to the most recently mounted session still in the registry
      // so the shortcut keeps a target in multi-session layouts.
      const keys = [...sessions.keys()]
      lastMountedSession = keys[keys.length - 1]
    }
    if (panelState?.sessionId === sessionId) closePanel()
    undoStore.clear(sessionId)
    notify()
  }
}

/**
 * The session entry the keyboard should act on: the composer containing the
 * focused element when identifiable (the lowest ancestor of the focus that
 * also contains a registered button, within the composer card's depth),
 * otherwise the most recently mounted one.
 * @returns the entry, or undefined when no composer is registered.
 */
function focusedEntry(): SessionEntry | undefined {
  const active = document.activeElement
  if (active !== null && active instanceof Element) {
    let node: Element | null = active
    // The composer card sits within a handful of levels above the textarea;
    // stopping here keeps a settings-page focus from matching via <body>.
    for (let depth = 0; depth < 8 && node !== null; depth++) {
      for (const entry of sessions.values()) {
        if (entry.root !== null && (node === entry.root || node.contains(entry.root))) return entry
      }
      node = node.parentElement
    }
  }
  return lastMountedSession !== undefined ? sessions.get(lastMountedSession) : undefined
}

/**
 * The composer that actually contains the focused element.
 *
 * Unlike {@link focusedEntry} this never falls back to "the most recently
 * mounted composer": Ctrl+Z must be claimed ONLY when the user's caret is in a
 * composer. Otherwise pressing Ctrl+Z in a settings field, the search box or
 * any other text input would silently rewrite the composer draft behind them —
 * the shortcut tolerates a loose target, a text-editing key does not.
 * @returns the entry under the focus, or undefined when focus is elsewhere.
 */
function composerUnderFocus(): SessionEntry | undefined {
  const active = document.activeElement
  if (active === null || !(active instanceof Element)) return undefined
  let node: Element | null = active
  for (let depth = 0; depth < 8 && node !== null; depth++) {
    for (const entry of sessions.values()) {
      if (entry.root !== null && (node === entry.root || node.contains(entry.root))) return entry
    }
    node = node.parentElement
  }
  return undefined
}

/**
 * Pick the session the enhance shortcut should act on.
 * @returns the entry's run callback, or undefined when there is no composer.
 */
export function shortcutTarget(): (() => void) | undefined {
  const entry = focusedEntry()
  return entry === undefined ? undefined : () => entry.run()
}

/**
 * Restore the focused composer's newest undo entry, if it still matches the
 * live draft (the same staleness rule the undo bar applies — an entry whose
 * applied text is no longer in the box describes a state the user already
 * left behind).
 *
 * Requires the focus to be inside a composer: this key is shared with ordinary
 * text editing, so an unconditional "most recent composer" fallback would let
 * Ctrl+Z typed anywhere fight the field the user is actually in.
 * @returns true when a replacement was undone and the key must be swallowed.
 */
export function undoTarget(): boolean {
  const entry = composerUnderFocus()
  if (entry?.undo === undefined) return false
  return entry.undo()
}
